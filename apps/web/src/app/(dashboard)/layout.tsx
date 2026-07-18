'use client';
import Link from 'next/link';
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LiveMessage } from '@pulsegrid/shared-types';
import { DemoBanner } from '@/components/DemoBanner';
import { Sidebar } from '@/components/Sidebar';
import { useLiveSocket } from '@/lib/live';
import { useSession } from '@/lib/session';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const sessionId = useSession((s) => s.sessionId);
  const queryClient = useQueryClient();

  // Central live-message router: pushes updates into the query cache so every
  // page re-renders from one source of truth without page-level sockets.
  const onMessage = useCallback(
    (msg: LiveMessage) => {
      queryClient.setQueryData(['live', msg.type], msg);
      if (msg.type === 'metrics') queryClient.setQueryData(['live', 'metrics'], msg);
      if (msg.type === 'alert') void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      if (msg.type === 'incident') void queryClient.invalidateQueries({ queryKey: ['incidents'] });
      if (msg.type === 'dlq') void queryClient.invalidateQueries({ queryKey: ['dead-letter'] });
      if (msg.type === 'scenario') void queryClient.invalidateQueries({ queryKey: ['simulation'] });
      // High-frequency types (event, trace) are consumed via cache subscription
      // on their pages with bounded buffers.
      if (msg.type === 'event' || msg.type === 'trace') {
        const key = ['stream', msg.type];
        const prev = (queryClient.getQueryData(key) as LiveMessage[] | undefined) ?? [];
        queryClient.setQueryData(key, [msg, ...prev].slice(0, 200));
      }
    },
    [queryClient],
  );
  const liveStatus = useLiveSocket(onMessage);

  if (!sessionId) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="card max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold">No active demo session</h1>
          <p className="mt-2 text-sm text-muted">
            Start a session from the landing page to get your own isolated sandbox with live telemetry.
          </p>
          <Link href="/" className="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg">
            Go to landing page
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar liveStatus={liveStatus} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        {liveStatus === 'offline' && (
          <div className="border-b border-border bg-critical/10 px-4 py-1.5 text-center text-xs text-critical">
            Live stream disconnected — retrying. Data below may be a few seconds stale.
          </div>
        )}
        <main className="flex-1 overflow-x-auto p-6">{children}</main>
      </div>
    </div>
  );
}
