import { Controller, Get, Param, Query, Req, NotFoundException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { dependencyEdges, serviceIds, serviceMeta, ServiceId } from '@pulsegrid/config';
import type { ServiceSummary } from '@pulsegrid/shared-types';
import { DatabaseService } from '../common/database.service';
import { RedisService } from '../common/redis.service';
import { SessionService } from '../common/session.service';

interface LiveServiceState {
  state?: string; rps?: number; errorRate?: number; p50Ms?: number; p95Ms?: number; p99Ms?: number; queueDepth?: number;
}

@ApiTags('services')
@Controller('api/services')
export class ServicesController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
  ) {}

  private async liveState(sessionId: string): Promise<Record<string, LiveServiceState>> {
    const raw = await this.redis.client.get(this.redis.liveStateKey(sessionId));
    if (!raw) return {};
    try {
      return (JSON.parse(raw) as { services?: Record<string, LiveServiceState> }).services ?? {};
    } catch {
      return {};
    }
  }

  @Get()
  async list(@Req() req: Request): Promise<ServiceSummary[]> {
    const sessionId = await this.sessions.require(req);
    const live = await this.liveState(sessionId);
    return serviceIds.map((id) => this.toSummary(id, live[id] ?? {}));
  }

  @Get(':id')
  async one(@Req() req: Request, @Param('id') id: string): Promise<ServiceSummary> {
    const sessionId = await this.sessions.require(req);
    if (!serviceIds.includes(id as ServiceId)) throw new NotFoundException(`Unknown service '${id}'.`);
    const live = await this.liveState(sessionId);
    return this.toSummary(id as ServiceId, live[id] ?? {});
  }

  @Get(':id/metrics')
  async metrics(@Req() req: Request, @Param('id') id: string, @Query('minutes') minutes?: string) {
    const sessionId = await this.sessions.require(req);
    if (!serviceIds.includes(id as ServiceId)) throw new NotFoundException(`Unknown service '${id}'.`);
    const span = Math.min(Math.max(Number(minutes ?? 15) || 15, 1), 120);
    const rows = await this.db.query<{
      ts: string; rps: string; error_rate: string; p50_ms: string; p95_ms: string; p99_ms: string; queue_depth: number; health_state: string;
    }>(
      `SELECT ts, rps, error_rate, p50_ms, p95_ms, p99_ms, queue_depth, health_state
       FROM metric_snapshots WHERE session_id=$1 AND service_name=$2 AND ts > now() - ($3 || ' minutes')::interval
       ORDER BY ts ASC`, [sessionId, id, String(span)]);
    return rows.map((r) => ({
      ts: r.ts, serviceName: id, rps: Number(r.rps), errorRate: Number(r.error_rate),
      p50Ms: Number(r.p50_ms), p95Ms: Number(r.p95_ms), p99Ms: Number(r.p99_ms),
      queueDepth: r.queue_depth, healthState: r.health_state,
    }));
  }

  private toSummary(id: ServiceId, live: LiveServiceState): ServiceSummary {
    return {
      id,
      displayName: serviceMeta[id].displayName,
      description: serviceMeta[id].description,
      tier: id === 'auth-service' ? 'edge' : id === 'notification-service' ? 'async' : 'core',
      health: (live.state as ServiceSummary['health']) ?? 'unknown',
      rps: live.rps ?? 0,
      errorRate: live.errorRate ?? 0,
      p50Ms: live.p50Ms ?? 0,
      p95Ms: live.p95Ms ?? 0,
      p99Ms: live.p99Ms ?? 0,
      queueDepth: live.queueDepth ?? 0,
      upstream: dependencyEdges.filter(([, d]) => d === id).map(([u]) => u),
      downstream: dependencyEdges.filter(([u]) => u === id).map(([, d]) => d),
    };
  }
}
