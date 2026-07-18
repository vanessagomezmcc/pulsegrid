import {
  Controller, Get, HttpCode, HttpException, NotFoundException, Param, Post, Query, Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { topics } from '@pulsegrid/event-schemas';
import { DatabaseService } from '../common/database.service';
import { KafkaService } from '../common/kafka.service';
import { RedisService, LIVE_CHANNEL } from '../common/redis.service';
import { SessionService, SEED_SESSION } from '../common/session.service';

@ApiTags('dead-letter')
@Controller('api/dead-letter')
export class DeadLetterController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly kafka: KafkaService,
    private readonly sessions: SessionService,
  ) {}

  @Get()
  async list(@Req() req: Request, @Query('status') status?: string, @Query('kind') kind?: string) {
    const sessionId = await this.sessions.require(req);
    const params: unknown[] = [sessionId, SEED_SESSION];
    let where = `session_id IN ($1,$2)`;
    if (status) { params.push(status); where += ` AND status = $${params.length}`; }
    if (kind) { params.push(kind); where += ` AND kind = $${params.length}`; }
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM dead_letter_events WHERE ${where} ORDER BY last_failure_at DESC LIMIT 100`, params);
    return rows.map(mapDlq);
  }

  @Get(':id')
  async one(@Req() req: Request, @Param('id') id: string) {
    const row = await this.find(req, id);
    return mapDlq(row);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Really retry the failed operation: re-deliver the notification, or re-publish the original payload to the raw topic.',
  })
  async retry(@Req() req: Request, @Param('id') id: string) {
    const sessionId = await this.sessions.require(req);
    if (!(await this.redis.allowAction(sessionId, 'dlq-retry', 10, 60))) {
      throw new HttpException('Retry rate limit reached; wait a minute.', 429);
    }
    const row = await this.find(req, id);
    if (row.session_id === SEED_SESSION) {
      throw new HttpException('Seeded historical examples cannot be retried.', 409);
    }
    if (row.status === 'resolved' || row.status === 'discarded') {
      throw new HttpException(`Cannot retry an event in '${row.status}' state.`, 409);
    }

    let ok = false;
    let detail = '';
    if (row.kind === 'notification_delivery') {
      ({ ok, detail } = await this.redeliverNotification(String(row.original_payload), sessionId));
    } else {
      ok = await this.kafka.publish(topics.telemetryRaw, id, String(row.original_payload));
      detail = ok
        ? 'Original payload re-published to the raw topic; it will re-validate on consumption.'
        : 'Kafka producer unavailable.';
    }

    const newStatus = ok && row.kind === 'notification_delivery' ? 'resolved' : ok ? 'retrying' : 'failed';
    await this.db.query(
      `UPDATE dead_letter_events SET status=$2, retry_count=retry_count+1, last_failure_at=CASE WHEN $3 THEN last_failure_at ELSE now() END, updated_at=now() WHERE id=$1`,
      [id, newStatus, ok],
    );
    await this.sessions.audit(sessionId, 'retry', 'dead_letter', id, { ok, detail });
    await this.redis.client.publish(LIVE_CHANNEL, JSON.stringify({
      type: 'dlq', sessionId, at: new Date().toISOString(), payload: { id, status: newStatus, retried: true },
    }));
    if (!ok) throw new HttpException(`Retry failed: ${detail}`, 502);
    return { id, status: newStatus, detail };
  }

  @Post(':id/discard')
  @HttpCode(200)
  async discard(@Req() req: Request, @Param('id') id: string) {
    const sessionId = await this.sessions.require(req);
    const row = await this.find(req, id);
    if (row.session_id === SEED_SESSION) {
      throw new HttpException('Seeded historical examples cannot be modified.', 409);
    }
    await this.db.query(
      `UPDATE dead_letter_events SET status='discarded', updated_at=now() WHERE id=$1 AND session_id=$2`,
      [id, sessionId],
    );
    await this.sessions.audit(sessionId, 'discard', 'dead_letter', id);
    return { id, status: 'discarded' };
  }

  private async find(req: Request, id: string) {
    const sessionId = await this.sessions.require(req);
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM dead_letter_events WHERE id=$1 AND session_id IN ($2,$3)`,
      [id, sessionId, SEED_SESSION],
    );
    if (!rows[0]) throw new NotFoundException('Dead-letter event not found in this session.');
    return rows[0];
  }

  private async redeliverNotification(payload: string, sessionId: string) {
    try {
      const body = JSON.parse(payload) as { orderId?: string; channel?: string };
      const base = process.env.NOTIFICATION_URL ?? 'http://localhost:7104';
      const res = await fetch(`${base}/api/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pulsegrid-session': sessionId },
        body: JSON.stringify({ orderId: body.orderId ?? 'unknown', channel: body.channel ?? 'email' }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return { ok: true, detail: 'Notification re-delivered successfully.' };
      return { ok: false, detail: `Notification service returned ${res.status} (is an outage scenario still active?).` };
    } catch (err) {
      return { ok: false, detail: `Re-delivery failed: ${(err as Error).message}` };
    }
  }
}

function mapDlq(r: Record<string, unknown>) {
  return {
    id: r.id, kind: r.kind, sessionId: r.session_id, traceId: r.trace_id, sourceTopic: r.source_topic,
    originalPayload: r.original_payload, validationErrors: r.validation_errors,
    failureReason: r.failure_reason, firstFailureAt: r.first_failure_at, lastFailureAt: r.last_failure_at,
    retryCount: r.retry_count, status: r.status, isSeed: r.is_seed,
  };
}
