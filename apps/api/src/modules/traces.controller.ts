import { Controller, Get, NotFoundException, Param, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DatabaseService } from '../common/database.service';
import { SessionService, SEED_SESSION } from '../common/session.service';

@ApiTags('traces')
@Controller('api/traces')
export class TracesController {
  constructor(
    private readonly db: DatabaseService,
    private readonly sessions: SessionService,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('service') service?: string,
    @Query('minDurationMs') minDurationMs?: string,
    @Query('limit') limit?: string,
  ) {
    const sessionId = await this.sessions.require(req);
    const lim = Math.min(Math.max(Number(limit ?? 50) || 50, 1), 200);
    const params: unknown[] = [sessionId, SEED_SESSION];
    let where = `session_id IN ($1, $2)`;
    if (status === 'ok' || status === 'error') {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }
    if (service) {
      params.push(service);
      where += ` AND root_service = $${params.length}`;
    }
    const min = Number(minDurationMs ?? 0);
    if (min > 0) {
      params.push(min);
      where += ` AND duration_ms >= $${params.length}`;
    }
    params.push(lim);
    const rows = await this.db.query<{
      trace_id: string; session_id: string; root_service: string | null; root_endpoint: string | null;
      started_at: string; duration_ms: string; status: 'ok' | 'error'; span_count: number; error_count: number; is_seed: boolean;
    }>(
      `SELECT trace_id, session_id, root_service, root_endpoint, started_at, duration_ms, status, span_count, error_count, is_seed
       FROM traces WHERE ${where} ORDER BY started_at DESC LIMIT $${params.length}`, params);
    return rows.map((r) => ({
      traceId: r.trace_id, sessionId: r.session_id, rootService: r.root_service, rootEndpoint: r.root_endpoint,
      startedAt: r.started_at, durationMs: Number(r.duration_ms), status: r.status,
      spanCount: r.span_count, errorCount: r.error_count, isSeed: r.is_seed,
    }));
  }

  @Get(':id')
  async one(@Req() req: Request, @Param('id') id: string) {
    const sessionId = await this.sessions.require(req);
    const traces = await this.db.query<{
      trace_id: string; session_id: string; root_service: string | null; root_endpoint: string | null;
      started_at: string; ended_at: string; duration_ms: string; status: 'ok' | 'error'; span_count: number; error_count: number; is_seed: boolean;
    }>(
      `SELECT * FROM traces WHERE trace_id=$1 AND session_id IN ($2,$3)`, [id, sessionId, SEED_SESSION]);
    const t = traces[0];
    if (!t) throw new NotFoundException('Trace not found in this session.');
    const spans = await this.db.query<{
      span_id: string; trace_id: string; parent_span_id: string | null; service_name: string;
      operation: string; started_at: string; duration_ms: string; status: string; error_type: string | null;
    }>(`SELECT * FROM spans WHERE trace_id=$1 ORDER BY started_at ASC`, [id]);
    return {
      trace: {
        traceId: t.trace_id, sessionId: t.session_id, rootService: t.root_service, rootEndpoint: t.root_endpoint,
        startedAt: t.started_at, endedAt: t.ended_at, durationMs: Number(t.duration_ms), status: t.status,
        spanCount: t.span_count, errorCount: t.error_count, isSeed: t.is_seed,
      },
      spans: spans.map((s) => ({
        spanId: s.span_id, traceId: s.trace_id, parentSpanId: s.parent_span_id, serviceName: s.service_name,
        operation: s.operation, startedAt: s.started_at, durationMs: Number(s.duration_ms),
        status: s.status, errorType: s.error_type,
      })),
    };
  }
}
