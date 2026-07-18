import { Controller, Get, NotFoundException, Param, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DatabaseService } from '../common/database.service';
import { SessionService, SEED_SESSION } from '../common/session.service';

@ApiTags('incidents')
@Controller('api/incidents')
export class IncidentsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly sessions: SessionService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    const sessionId = await this.sessions.require(req);
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM incidents WHERE session_id IN ($1,$2) ORDER BY started_at DESC LIMIT 50`,
      [sessionId, SEED_SESSION]);
    return rows.map(mapIncident);
  }

  @Get(':id')
  async one(@Req() req: Request, @Param('id') id: string) {
    const sessionId = await this.sessions.require(req);
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM incidents WHERE id=$1 AND session_id IN ($2,$3)`, [id, sessionId, SEED_SESSION]);
    if (!rows[0]) throw new NotFoundException('Incident not found in this session.');
    const timeline = await this.db.query<Record<string, unknown>>(
      `SELECT id, incident_id, ts, kind, message, service_name, alert_id
       FROM incident_events WHERE incident_id=$1 ORDER BY ts ASC`, [id]);
    return {
      incident: mapIncident(rows[0]),
      timeline: timeline.map((t) => ({
        id: t.id, incidentId: t.incident_id, ts: t.ts, kind: t.kind, message: t.message,
        serviceName: t.service_name, alertId: t.alert_id,
      })),
    };
  }
}

function mapIncident(r: Record<string, unknown>) {
  return {
    id: r.id, sessionId: r.session_id, title: r.title, severity: r.severity, status: r.status,
    startedAt: r.started_at, resolvedAt: r.resolved_at,
    durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
    detectionMs: r.detection_ms === null ? null : Number(r.detection_ms),
    rootCauseService: r.root_cause_service, rootCauseHint: r.root_cause_hint, isSeed: r.is_seed,
  };
}
