import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

export const LIVE_CHANNEL = 'pulsegrid:live';
export const SESSIONS_SET = 'pulsegrid:sessions';
export const SESSION_TTL_SECONDS = 30 * 60;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: RedisClientType = createClient({
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  });
  /** Dedicated connection for pub/sub (redis protocol requirement). */
  readonly subscriber: RedisClientType = this.client.duplicate();

  async onModuleInit() {
    await this.client.connect();
    await this.subscriber.connect();
  }

  sessionKey(id: string) {
    return `pulsegrid:session:${id}`;
  }
  flagsKey(id: string) {
    return `pulsegrid:flags:${id}`;
  }
  liveStateKey(id: string) {
    return `pulsegrid:livestate:${id}`;
  }
  queueKey(id: string, name: string) {
    return `pulsegrid:queue:${id}:${name}`;
  }

  /** Simple fixed-window rate limiter for per-session mutating actions. */
  async allowAction(sessionId: string, action: string, limit: number, windowSec: number) {
    const key = `pulsegrid:rate:${sessionId}:${action}`;
    const n = await this.client.incr(key);
    if (n === 1) await this.client.expire(key, windowSec);
    return n <= limit;
  }

  async healthy(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
    await this.subscriber.quit().catch(() => undefined);
  }
}
