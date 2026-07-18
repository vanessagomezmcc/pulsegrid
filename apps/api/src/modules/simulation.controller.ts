import {
  Controller, Get, HttpCode, HttpException, Param, Post, Body, Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { randomBytes } from 'crypto';
import { scenarios, ScenarioId } from '@pulsegrid/config';
import { topics } from '@pulsegrid/event-schemas';
import { DatabaseService } from '../common/database.service';
import { KafkaService } from '../common/kafka.service';
import { RedisService, LIVE_CHANNEL } from '../common/redis.service';
import { SessionService } from '../common/session.service';

/** Mirror of go/shared/failure.ForScenario — must stay in lockstep. */
function flagsFor(id: ScenarioId, intensity: number) {
  const i = Math.min(Math.max(intensity, 1), 3) as 1 | 2 | 3;
  const base = {
    activeScenario: id as string, intensity: i, startedAt: new Date().toISOString(),
    paymentExtraLatencyMs: 0, paymentFailureRatePct: 0, paymentTimeoutRatePct: 0,
    orderDbDelayMs: 0, notificationOutage: false, notificationDelayMs: 0,
    trafficMultiplier: 1, queueWorkerPaused: false,
  };
  switch (id) {
    case 'payment-slowdown':
      base.paymentExtraLatencyMs = { 1: 800, 2: 1800, 3: 3500 }[i];
      base.paymentTimeoutRatePct = { 1: 0, 2: 2, 3: 8 }[i];
      break;
    case 'payment-error-spike':
      base.paymentFailureRatePct = { 1: 15, 2: 35, 3: 60 }[i];
      break;
    case 'notification-outage':
      base.notificationOutage = true;
      break;
    case 'order-db-delay':
      base.orderDbDelayMs = { 1: 500, 2: 1200, 3: 2500 }[i];
      break;
    case 'traffic-surge':
      base.trafficMultiplier = { 1: 2, 2: 4, 3: 8 }[i];
      break;
    case 'queue-worker-pause':
      base.queueWorkerPaused = true;
      break;
    case 'normal-traffic':
    case 'full-recovery':
      base.activeScenario = 'normal-traffic';
      break;
    case 'malformed-event':
      break; // one-shot; no standing flags
  }
  return base;
}

const STANDING = new Set(['payment-slowdown', 'payment-error-spike', 'notification-outage', 'order-db-delay', 'queue-worker-pause']);

@ApiTags('simulation')
@Controller('api/simulation')
export class SimulationController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly kafka: KafkaService,
    private readonly sessions: SessionService,
  ) {}

  @Get('scenarios')
  listScenarios() {
    return scenarios;
  }

  @Get('state')
  async state(@Req() req: Request) {
    const sessionId = await this.sessions.require(req);
    const raw = await this.redis.client.get(this.redis.flagsKey(sessionId));
    const runs = await this.db.query<Record<string, unknown>>(
      `SELECT id, scenario_id, intensity, status, started_at, stopped_at
       FROM simulation_runs WHERE session_id=$1 ORDER BY started_at DESC LIMIT 20`, [sessionId]);
    return {
      flags: raw ? JSON.parse(raw) : null,
      runs: runs.map((r) => ({
        id: r.id, scenarioId: r.scenario_id, sessionId, intensity: r.intensity,
        status: r.status, startedAt: r.started_at, stoppedAt: r.stopped_at,
      })),
    };
  }

  @Post('scenarios/:id/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start a scenario. This changes real backend behavior for your session.' })
  async start(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { intensity?: number },
  ) {
    const sessionId = await this.sessions.require(req);
    if (!scenarios.some((s) => s.id === id)) {
      throw new HttpException(`Unknown scenario '${id}'.`, 404);
    }
    if (!(await this.redis.allowAction(sessionId, 'scenario', 10, 60))) {
      throw new HttpException('Scenario rate limit reached (10/min); wait a moment.', 429);
    }
    const scenarioId = id as ScenarioId;
    const intensity = Math.min(Math.max(Number(body?.intensity ?? 2) || 2, 1), 3);

    // Conflict guard: one standing failure at a time (mirrors go/shared/failure.Conflicts).
    const rawCur = await this.redis.client.get(this.redis.flagsKey(sessionId));
    if (rawCur && STANDING.has(scenarioId)) {
      const cur = JSON.parse(rawCur) as { activeScenario?: string };
      if (cur.activeScenario && STANDING.has(cur.activeScenario) && cur.activeScenario !== scenarioId) {
        throw new HttpException(
          `Scenario '${cur.activeScenario}' is already active. Run Full Recovery first, or adjust its intensity.`, 409);
      }
    }

    if (scenarioId === 'malformed-event') {
      const ok = await this.kafka.publish(
        topics.telemetryRaw,
        `malformed-${Date.now()}`,
        JSON.stringify({
          eventId: `bad-${randomBytes(4).toString('hex')}`,
          eventVersion: '0.3', // wrong version + missing required fields → schema-invalid
          sessionId,
          serviceName: 'payment-service',
          note: 'intentionally malformed event injected from the Simulation Lab',
        }),
      );
      if (!ok) throw new HttpException('Kafka unavailable; cannot inject event.', 503);
    } else {
      await this.redis.client.set(this.redis.flagsKey(sessionId), JSON.stringify(flagsFor(scenarioId, intensity)), { EX: 30 * 60 });
      if (scenarioId === 'full-recovery' || scenarioId === 'normal-traffic') {
        await this.db.query(
          `UPDATE simulation_runs SET status='completed', stopped_at=now() WHERE session_id=$1 AND status='running'`,
          [sessionId]);
      } else {
        await this.db.query(
          `UPDATE simulation_runs SET status='stopped', stopped_at=now() WHERE session_id=$1 AND status='running' AND scenario_id<>$2`,
          [sessionId, scenarioId]);
      }
    }

    const runId = `run_${randomBytes(6).toString('hex')}`;
    await this.db.query(
      `INSERT INTO simulation_runs (id, scenario_id, session_id, intensity, status)
       VALUES ($1,$2,$3,$4,$5)`,
      [runId, scenarioId, sessionId, intensity, scenarioId === 'malformed-event' ? 'completed' : 'running']);
    await this.db.query(`UPDATE demo_sessions SET active_scenario=$2, updated_at=now() WHERE id=$1`,
      [sessionId, STANDING.has(scenarioId) || scenarioId === 'traffic-surge' ? scenarioId : null]);
    await this.sessions.audit(sessionId, 'start', 'scenario', scenarioId, { intensity });
    await this.redis.client.publish(LIVE_CHANNEL, JSON.stringify({
      type: 'scenario', sessionId, at: new Date().toISOString(),
      payload: { scenarioId, intensity, runId, action: 'start' },
    }));
    return { runId, scenarioId, intensity, status: 'running' };
  }

  @Post('stop')
  @HttpCode(200)
  @ApiOperation({ summary: 'Stop all scenarios (equivalent to Full Recovery).' })
  async stop(@Req() req: Request) {
    const sessionId = await this.sessions.require(req);
    await this.redis.client.set(this.redis.flagsKey(sessionId), JSON.stringify(flagsFor('full-recovery', 2)), { EX: 30 * 60 });
    await this.db.query(
      `UPDATE simulation_runs SET status='stopped', stopped_at=now() WHERE session_id=$1 AND status='running'`,
      [sessionId]);
    await this.db.query(`UPDATE demo_sessions SET active_scenario=NULL, updated_at=now() WHERE id=$1`, [sessionId]);
    await this.sessions.audit(sessionId, 'stop', 'scenario', 'all');
    await this.redis.client.publish(LIVE_CHANNEL, JSON.stringify({
      type: 'scenario', sessionId, at: new Date().toISOString(), payload: { action: 'stop' },
    }));
    return { stopped: true };
  }
}
