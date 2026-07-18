import { Controller, Get, HttpCode, HttpException, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DatabaseService } from '../common/database.service';
import { RedisService, LIVE_CHANNEL } from '../common/redis.service';
import { SessionService, SEED_SESSION } from '../common/session.service';

const ALERT_ROW = `
  SELECT o.id, o.rule_id, r.name AS rule_name, r.description, r.service_name, r.metric,
         o.state, o.severity, o.value, o.threshold, o.started_at, o.firing_at,
         o.acknowledged_at, o.resolved_at, o.incident_id
  FROM alert_occurrences o JOIN alert_rules r ON r.id = o.rule_id`;

@ApiTags('alerts')
@Controller('api/alerts')
export class AlertsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
  ) {}

  @Get('rules')
  async rules() {
    return this.db.query(
      `SELECT id, name, description, service_name AS "serviceName", metric, comparator, threshold,
              for_seconds AS "forSeconds", severity, enabled
       FROM alert_rules ORDER BY id`);
  }

  @Get()
  async list(@Req() req: Request, @Query('state') state?: string) {
    const sessionId = await this.sessions.require(req);
    const params: unknown[] = [sessionId, SEED_SESSION];
    let where = `o.session_id IN ($1,$2)`;
    if (state) {
      params.push(state);
      where += ` AND o.state = $${params.length}`;
    }
    const rows = await this.db.query<Record<string, unknown>>(
      `${ALERT_ROW} WHERE ${where} ORDER BY o.updated_at DESC LIMIT 100`, params);
    return rows.map(mapAlert);
  }

  @Get(':id')
  async one(@Req() req: Request, @Param('id') id: string) {
    const sessionId = await this.sessions.require(req);
    const rows = await this.db.query<Record<string, unknown>>(
      `${ALERT_ROW} WHERE o.id=$1 AND o.session_id IN ($2,$3)`, [id, sessionId, SEED_SESSION]);
    if (!rows[0]) throw new NotFoundException('Alert not found in this session.');
    return mapAlert(rows[0]);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @ApiOperation({ summary: 'Acknowledge a firing alert (recorded in the audit log).' })
  async acknowledge(@Req() req: Request, @Param('id') id: string) {
    const sessionId = await this.sessions.require(req);
    if (!(await this.redis.allowAction(sessionId, 'ack-alert', 20, 60))) {
      throw new HttpException('Acknowledgement rate limit reached; slow down.', 429);
    }
    const rows = await this.db.query<{ state: string }>(
      `UPDATE alert_occurrences SET state='acknowledged', acknowledged_at=now(), updated_at=now()
       WHERE id=$1 AND session_id=$2 AND state='firing' RETURNING state`, [id, sessionId]);
    if (!rows[0]) {
      throw new HttpException('Only firing alerts in your own session can be acknowledged.', 409);
    }
    await this.sessions.audit(sessionId, 'acknowledge', 'alert', id);
    await this.redis.client.publish(LIVE_CHANNEL, JSON.stringify({
      type: 'alert', sessionId, at: new Date().toISOString(),
      payload: { occurrenceId: id, to: 'acknowledged' },
    }));
    return { id, state: 'acknowledged' };
  }
}

function mapAlert(r: Record<string, unknown>) {
  return {
    id: r.id, ruleId: r.rule_id, ruleName: r.rule_name, description: r.description,
    serviceName: r.service_name, metric: r.metric, state: r.state, severity: r.severity,
    value: Number(r.value), threshold: Number(r.threshold), startedAt: r.started_at,
    firingAt: r.firing_at, acknowledgedAt: r.acknowledged_at, resolvedAt: r.resolved_at,
    incidentId: r.incident_id,
  };
}
