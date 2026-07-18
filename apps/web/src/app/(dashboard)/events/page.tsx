'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { LiveMessage } from '@pulsegrid/shared-types';
import { formatDuration } from '@pulsegrid/ui';
import { Empty } from '@/components/DataState';
import { api } from '@/lib/api';

interface StreamEvent {
  eventId: string; service: string; eventType: string; endpoint: string; traceId: string;
  status: string; durationMs: number; ts: string; queueName?: string; errorType?: string;
}

const MAX_ROWS = 200;

export default function EventStreamPage() {
  const queryClient = useQueryClient();
  const [paused, setPaused] = useState(false);
  const [serviceFilter, setServiceFilter] = useState('');
  const [rows, setRows] = useState<StreamEvent[]>([]);

  // Initial backfill from the API so the page is never empty on load.
  const backfill = useQuery({
    queryKey: ['events', 'backfill'],
    queryFn: () => api<StreamEvent[]>('/api/events?limit=100'),
    refetchInterval: false,
  });
  useEffect(() => {
    if (backfill.data && rows.length === 0) setRows(backfill.data.slice(0, MAX_ROWS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backfill.data]);

  // Live tail: subscribe to the bounded buffer the dashboard layout maintains.
  useEffect(() => {
    if (paused) return;
    const interval = setInterval(() => {
      const buffered = (queryClient.getQueryData(['stream', 'event']) as LiveMessage<StreamEvent>[] | undefined) ?? [];
      if (buffered.length === 0) return;
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.eventId));
        const fresh = buffered.map((m) => m.payload).filter((e) => e && !seen.has(e.eventId));
        return fresh.length === 0 ? prev : [...fresh, ...prev].slice(0, MAX_ROWS);
      });
    }, 750);
    return () => clearInterval(interval);
  }, [paused, queryClient]);

  const visible = serviceFilter ? rows.filter((r) => r.service === serviceFilter) : rows;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Event Stream</h1>
          <p className="mt-1 text-sm text-muted">
            Live tail of the raw telemetry topic (most recent {MAX_ROWS} events kept in memory).
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} aria-label="Filter by service"
            className="rounded-md border border-border bg-surface px-2 py-1.5">
            <option value="">All services</option>
            {['auth-service', 'payment-service', 'order-service', 'notification-service'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button onClick={() => setPaused((p) => !p)} aria-pressed={paused}
            className={`rounded-md border px-3 py-1.5 ${paused ? 'border-warning text-warning' : 'border-border hover:border-accent'}`}>
            {paused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty title="Waiting for telemetry…" hint="Events appear within seconds while the pipeline runs." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Time</th><th className="px-3 py-2">Service</th>
                <th className="px-3 py-2">Type</th><th className="px-3 py-2">Endpoint / queue</th>
                <th className="px-3 py-2">Status</th><th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Trace</th>
              </tr>
            </thead>
            <tbody className="mono">
              {visible.map((e) => (
                <tr key={e.eventId} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-1.5 text-muted">{new Date(e.ts).toLocaleTimeString()}</td>
                  <td className="px-3 py-1.5">{e.service}</td>
                  <td className="px-3 py-1.5 text-muted">{e.eventType}</td>
                  <td className="max-w-56 truncate px-3 py-1.5">{e.queueName ? `queue:${e.queueName}` : e.endpoint}</td>
                  <td className={`px-3 py-1.5 ${e.status === 'ok' ? 'text-healthy' : e.status === 'skipped' ? 'text-muted' : 'text-critical'}`}>
                    {e.status}{e.errorType ? ` (${e.errorType})` : ''}
                  </td>
                  <td className="px-3 py-1.5">{formatDuration(e.durationMs)}</td>
                  <td className="px-3 py-1.5">
                    <a href={`/traces/${e.traceId}`} className="text-accent hover:underline">{e.traceId.slice(0, 8)}…</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
