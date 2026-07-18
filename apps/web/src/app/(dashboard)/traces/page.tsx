'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { LiveMessage, TraceSummary } from '@pulsegrid/shared-types';
import { formatDuration, formatRelative } from '@pulsegrid/ui';
import { Empty, ErrorState, Loading } from '@/components/DataState';
import { api } from '@/lib/api';

export default function TracesPage() {
  const params = useSearchParams();
  const [status, setStatus] = useState<string>(params.get('status') ?? '');
  const [service, setService] = useState<string>(params.get('service') ?? '');
  const [minMs, setMinMs] = useState<string>('');
  const queryClient = useQueryClient();
  const liveCount = ((queryClient.getQueryData(['stream', 'trace']) as LiveMessage[] | undefined) ?? []).length;

  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (service) qs.set('service', service);
  if (minMs) qs.set('minDurationMs', minMs);
  const q = useQuery({
    queryKey: ['traces', status, service, minMs],
    queryFn: () => api<TraceSummary[]>(`/api/traces?${qs.toString()}`),
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Traces</h1>
        <div className="flex flex-wrap gap-2 text-sm">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"
            className="rounded-md border border-border bg-surface px-2 py-1.5">
            <option value="">All statuses</option><option value="ok">OK</option><option value="error">Error</option>
          </select>
          <select value={service} onChange={(e) => setService(e.target.value)} aria-label="Filter by root service"
            className="rounded-md border border-border bg-surface px-2 py-1.5">
            <option value="">All root services</option>
            {['auth-service', 'payment-service', 'order-service', 'notification-service'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input value={minMs} onChange={(e) => setMinMs(e.target.value.replace(/\D/g, ''))} placeholder="Min duration (ms)"
            aria-label="Minimum duration in milliseconds"
            className="w-36 rounded-md border border-border bg-surface px-2 py-1.5" />
        </div>
      </div>

      {liveCount > 0 && <p className="text-xs text-muted">{liveCount} traces streamed live this session — list refreshes every 5 s.</p>}

      {q.isLoading ? (
        <Loading label="Loading traces…" />
      ) : q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <Empty title="No traces match these filters" hint="Loosen the filters, or generate traffic from the Simulation Lab." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Trace</th><th className="px-4 py-3">Root</th>
                <th className="px-4 py-3">Duration</th><th className="px-4 py-3">Spans</th>
                <th className="px-4 py-3">Status</th><th className="px-4 py-3">Started</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((t) => (
                <tr key={t.traceId} className="border-b border-border/50 last:border-0 hover:bg-bg-secondary/50">
                  <td className="mono px-4 py-3 text-xs">
                    <Link href={`/traces/${t.traceId}`} className="hover:text-accent">{t.traceId.slice(0, 16)}…</Link>
                    {t.isSeed && <span className="ml-2 rounded bg-bg-secondary px-1.5 py-0.5 text-[10px] text-muted">seed</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">{t.rootService}<span className="text-muted"> {t.rootEndpoint}</span></td>
                  <td className="mono px-4 py-3">{formatDuration(t.durationMs)}</td>
                  <td className="mono px-4 py-3">{t.spanCount}{t.errorCount > 0 && <span className="text-critical"> ({t.errorCount} err)</span>}</td>
                  <td className="px-4 py-3">
                    <span className={t.status === 'ok' ? 'text-healthy' : 'text-critical'}>{t.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{formatRelative(t.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
