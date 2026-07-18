import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { DatabaseService } from './database.service';
import { RedisService, SESSIONS_SET, SESSION_TTL_SECONDS } from './redis.service';

export const SEED_SESSION = 'seed-history';

/**
 * Demo-session guardrails. Every session-scoped endpoint resolves the session
 * from the x-pulsegrid-session header, verifies it exists, refreshes its TTL,
 * and never lets one guest touch another session's state.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  extract(req: Request): string {
    const id = (req.headers['x-pulsegrid-session'] ?? '') as string;
    if (!id || !/^[a-z0-9-]{8,64}$/.test(id)) {
      throw new BadRequestException('Missing or malformed x-pulsegrid-session header.');
    }
    return id;
  }

  async require(req: Request): Promise<string> {
    const id = this.extract(req);
    const exists = await this.redis.client.sIsMember(SESSIONS_SET, id);
    if (!exists) {
      throw new NotFoundException(
        'Demo session not found or expired. Create a new one from the landing page.',
      );
    }
    await this.touch(id);
    return id;
  }

  async touch(id: string) {
    const key = this.redis.sessionKey(id);
    await this.redis.client.hSet(key, 'lastSeenAt', new Date().toISOString());
    await this.redis.client.expire(key, SESSION_TTL_SECONDS);
    await this.db
      .query(`UPDATE demo_sessions SET last_seen_at = now() WHERE id = $1`, [id])
      .catch(() => undefined);
  }

  async audit(sessionId: string, action: string, targetType: string, targetId: string, detail?: object) {
    await this.db.query(
      `INSERT INTO audit_events (session_id, actor, action, target_type, target_id, detail)
       VALUES ($1,'guest',$2,$3,$4,$5)`,
      [sessionId, action, targetType, targetId, detail ? JSON.stringify(detail) : null],
    );
  }
}
