'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ServiceSummary } from '@pulsegrid/shared-types';
import { StatusDot, formatDuration, formatPercent } from '@pulsegrid/ui';
import { ErrorState, Loading } from '@/components/DataState';
import { api } from '@/lib/api';

export default function ServicesPage() {
  const q = useQuery({ queryKey: ['services'], queryFn: () => api<ServiceSummary[]>('/api/services') });
  if (q.isLoading) return <Loading label="Loading services…" />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Services</h1>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Service</th><th className="px-4 py-3">Health</th>
              <th className="px-4 py-3">RPS</th><th className="px-4 py-3">Error rate</th>
              <th className="px-4 py-3">p50 / p95 / p99</th><th className="px-4 py-3">Queue</th>
              <th className="px-4 py-3">Depends on</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((s) => (
              <tr key={s.id} className="border-b border-border/50 last:border-0 hover:bg-bg-secondary/50">
                <td className="px-4 py-3">
                  <Link href={`/services/${s.id}`} className="font-medium hover:text-accent">{s.displayName}</Link>
                  <p className="text-xs text-muted">{s.id}</p>
                </td>
                <td className="px-4 py-3"><StatusDot state={s.health} /></td>
                <td className="mono px-4 py-3">{s.rps.toFixed(1)}</td>
                <td className="mono px-4 py-3">{formatPercent(s.errorRate)}</td>
                <td className="mono px-4 py-3">
                  {formatDuration(s.p50Ms)} / {formatDuration(s.p95Ms)} / {formatDuration(s.p99Ms)}
                </td>
                <td className="mono px-4 py-3">{s.queueDepth || '—'}</td>
                <td className="px-4 py-3 text-xs text-muted">{s.downstream.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
