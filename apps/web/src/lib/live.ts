'use client';

import { useEffect, useRef, useState } from 'react';
import type { LiveMessage } from '@pulsegrid/shared-types';
import { DEMO_MODE, WS_URL } from './api';
import { subscribeDemoLive } from './demo-api';
import { useSession } from './session';

export type LiveStatus = 'connecting' | 'live' | 'offline';

/** Subscribes to live updates from either the real WebSocket or browser demo. */
export function useLiveSocket(onMessage: (msg: LiveMessage) => void): LiveStatus {
  const sessionId = useSession((state) => state.sessionId);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    if (!sessionId) return;

    if (DEMO_MODE) {
      setStatus('live');
      return subscribeDemoLive((message) => handler.current(message));
    }

    let ws: WebSocket | null = null;
    let attempts = 0;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      setStatus('connecting');
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        attempts = 0;
        setStatus('live');
        ws?.send(JSON.stringify({ type: 'subscribe', sessionId }));
      };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as LiveMessage;
          if (message.type) handler.current(message);
        } catch {
          // Ignore malformed frames.
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus('offline');
        attempts += 1;
        timer = setTimeout(connect, Math.min(1000 * 2 ** attempts, 15_000));
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [sessionId]);

  return status;
}
