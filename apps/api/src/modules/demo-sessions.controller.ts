import {
  Controller, Delete, Get, HttpCode, Param, Post, Req, HttpException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../common/database.service';
import { RedisService, SESSIONS_SET, SESSION_TTL_SECONDS } from '../common/redis.service';
import { SessionService } from '../common/session.service';

@ApiTags('demo-sessions')
@Controller('api/demo/sessions')
export class DemoSessionsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create an isolated demo session (no signup needed).' })
  async create(@Req() req: Request) {
    const ip = req.ip ?? 'unknown';
    if (!(await this.redis.allowAction(`ip:${ip}`, 'create-session', 5, 60))) {
      throw new HttpException('Too many sessions created from this address; wait a minute.', 429);
    }
    const id = `sess-${randomBytes(9).toString('hex')}`;
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
    await this.db.query(
      `INSERT INTO demo_sessions (id, status, expires_at) VALUES ($1,'active',$2)`,
      [id, expires.toISOString()],
    );
    await this.redis.client.sAdd(SESSIONS_SET, id);
    await this.redis.client.hSet(this.redis.sessionKey(id), {
      createdAt: now.toISOString(), lastSeenAt: now.toISOString(),
    });
    await this.redis.client.expire(this.redis.sessionKey(id), SESSION_TTL_SECONDS);
    await this.sessions.audit(id, 'create', 'session', id);
    return { id, status: 'active', activeScenario: null, createdAt: now.toISOString(), expiresAt: expires.toISOString() };
  }

  @Get(':id')
  async get(@Req() req: Request, @Param('id') id: string) {
    const sess = await this.sessions.require(req);
    if (sess !== id) throw new HttpException('Session mismatch.', 403);
    const rows = await this.db.query<{ id: string; status: string; active_scenario: string | null; created_at: string; expires_at: string }>(
      `SELECT id, status, active_scenario, created_at, expires_at FROM demo_sessions WHERE id=$1`, [id]);
    const r = rows[0];
    if (!r) throw new HttpException('Session not found.', 404);
    return { id: r.id, status: r.status, activeScenario: r.active_scenario, createdAt: r.created_at, expiresAt: r.expires_at };
  }

  @Post(':id/reset')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reset the environment: clear scenarios, queues, and session-scoped state.' })
  async reset(@Req() req: Request, @Param('id') id: string) {
    const sess = await this.sessions.require(req);
    if (sess !== id) throw new HttpException('Session mismatch.', 403);
    await this.wipe(id, 'reset');
    await this.sessions.audit(id, 'reset', 'session', id);
    return { id, status: 'active', reset: true };
  }

  @Delete(':id')
  @HttpCode(204)
  async destroy(@Req() req: Request, @Param('id') id: string) {
    const sess = await this.sessions.require(req);
    if (sess !== id) throw new HttpException('Session mismatch.', 403);
    await this.wipe(id, 'expired');
    await this.redis.client.sRem(SESSIONS_SET, id);
    await this.redis.client.del(this.redis.sessionKey(id));
  }

  private async wipe(id: string, status: string) {
    await this.redis.client.del(this.redis.flagsKey(id));
    await this.redis.client.del(this.redis.queueKey(id, 'notifications'));
    await this.redis.client.del(this.redis.liveStateKey(id));
    for (const t of ['telemetry_events', 'traces', 'metric_snapshots', 'alert_occurrences', 'incidents', 'dead_letter_events', 'simulation_runs']) {
      await this.db.query(`DELETE FROM ${t} WHERE session_id = $1`, [id]); // table names from fixed list above
    }
    await this.db.query(`UPDATE demo_sessions SET status=$2, active_scenario=NULL, updated_at=now() WHERE id=$1`, [id, status]);
  }
}
