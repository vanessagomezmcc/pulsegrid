import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DatabaseService } from '../common/database.service';
import { SessionService } from '../common/session.service';

@ApiTags('events')
@Controller('api/events')
export class EventsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly sessions: SessionService,
  ) {}

  /** Recent raw telemetry for the Event Stream page's initial backfill. */
  @Get()
  async list(
    @Req() req: Request,
    @Query('service') service?: string,
    @Query('status') status?: string,
    @Query('eventType') eventType?: string,
    @Query('limit') limit?: string,
  ) {
    const sessionId = await this.sessions.require(req);
    const lim = Math.min(Math.max(Number(limit ?? 100) || 100, 1), 500);
    const params: unknown[] = [sessionId];
    let where = `session_id = $1`;
    for (const [col, val] of [
      ['service_name', service],
      ['status', status],
      ['event_type', eventType],
    ] as const) {
      if (val) {
        params.push(val);
        where += ` AND ${col} = $${params.length}`;
      }
    }
    params.push(lim);
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT event_id, trace_id, service_name, event_type, endpoint, status, status_code,
              duration_ms, ts, error_type, queue_name
       FROM telemetry_events WHERE ${where} ORDER BY ts DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map((r) => ({
      eventId: r.event_id, traceId: r.trace_id, service: r.service_name, eventType: r.event_type,
      endpoint: r.endpoint, status: r.status, statusCode: r.status_code,
      durationMs: Number(r.duration_ms), ts: r.ts, errorType: r.error_type, queueName: r.queue_name,
    }));
  }
}
