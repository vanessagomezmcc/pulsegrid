'use client';
import { useEffect, useRef, useState } from 'react';
import type { LiveMessage } from '@pulsegrid/shared-types';
import { WS_URL } from './api';
import { useSession } from './session';

export type LiveStatus = 'connecting' | 'live' | 'offline';

/**
 * Subscribes to the session's live update stream with automatic exponential
 * backoff reconnect. Handlers are held in a ref so re-renders never re-open
 * the socket.
 */
export function useLiveSocket(onMessage: (msg: LiveMessage) => void): LiveStatus {
  const sessionId = useSession((s) => s.sessionId);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    if (!sessionId) return;
    let ws: WebSocket | null = null;
    let attempts = 0;
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      setStatus('connecting');
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        attempts = 0;
        setStatus('live');
        ws?.send(JSON.stringify({ type: 'subscribe', sessionId }));
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as LiveMessage;
          if (msg.type) handler.current(msg);
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus('offline');
        attempts += 1;
        timer = setTimeout(connect, Math.min(1000 * 2 ** attempts, 15000));
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [sessionId]);

  return status;
}
