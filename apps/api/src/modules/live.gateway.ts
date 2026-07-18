import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import { RedisService, LIVE_CHANNEL } from '../common/redis.service';

interface TaggedSocket extends WebSocket {
  sessionId?: string;
}

/**
 * Relays telemetry-processor live updates (Redis pub/sub) to browsers over a
 * plain WebSocket. Clients send {"type":"subscribe","sessionId":"..."} once;
 * afterwards they only receive messages for their own session.
 */
@WebSocketGateway({ path: '/ws' })
export class LiveGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger(LiveGateway.name);
  private readonly clients = new Set<TaggedSocket>();
  private readonly allowedOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',');

  constructor(private readonly redis: RedisService) {}

  async afterInit() {
    await this.redis.subscriber.subscribe(LIVE_CHANNEL, (message) => {
      let sessionId = '';
      try {
        sessionId = (JSON.parse(message) as { sessionId?: string }).sessionId ?? '';
      } catch {
        return;
      }
      for (const client of this.clients) {
        if (client.readyState === client.OPEN && client.sessionId === sessionId) {
          client.send(message);
        }
      }
    });
    this.log.log(`Subscribed to ${LIVE_CHANNEL}`);
  }

  handleConnection(client: TaggedSocket, req: IncomingMessage) {
    const origin = req.headers.origin ?? '';
    if (origin && !this.allowedOrigins.includes(origin)) {
      client.close(4403, 'Origin not allowed');
      return;
    }
    this.clients.add(client);
    client.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; sessionId?: string };
        if (msg.type === 'subscribe' && typeof msg.sessionId === 'string' && /^[a-z0-9-]{8,64}$/.test(msg.sessionId)) {
          client.sessionId = msg.sessionId;
          client.send(JSON.stringify({ type: 'subscribed', sessionId: msg.sessionId, at: new Date().toISOString() }));
        }
      } catch {
        // ignore malformed client frames
      }
    });
  }

  handleDisconnect(client: TaggedSocket) {
    this.clients.delete(client);
  }
}
