'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { MetricPoint, ServiceSummary } from '@pulsegrid/shared-types';
import { StatusDot, formatDuration, formatPercent } from '@pulsegrid/ui';
import { ErrorState, Loading } from '@/components/DataState';
import { MetricCard } from '@/components/MetricCard';
import { TimeSeries } from '@/components/TimeSeries';
import { api } from '@/lib/api';

export default function ServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const svc = useQuery({
    queryKey: ['services', id],
    queryFn: () => api<ServiceSummary>(`/api/services/${id}`),
  });
  const metrics = useQuery({
    queryKey: ['services', id, 'metrics'],
    queryFn: () => api<MetricPoint[]>(`/api/services/${id}/metrics?minutes=15`),
    refetchInterval: 5000,
  });

  if (svc.isLoading) return <Loading label="Loading service…" />;
  if (svc.isError) return <ErrorState message={(svc.error as Error).message} onRetry={() => void svc.refetch()} />;
  const s = svc.data;
  if (!s) return null;
  const points = (metrics.data ?? []).map((p) => ({ ...p, errorPct: p.errorRate * 100 }));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{s.displayName}</h1>
          <StatusDot state={s.health} pulse />
        </div>
        <p className="mt-1 text-sm text-muted">{s.description}</p>
        <p className="mt-1 text-xs text-muted">
          {s.upstream.length > 0 && <>Called by <span className="mono">{s.upstream.join(', ')}</span> · </>}
          {s.downstream.length > 0 ? <>Calls <span className="mono">{s.downstream.join(', ')}</span></> : 'Terminal service'}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Throughput" value={`${s.rps.toFixed(1)} rps`} />
        <MetricCard label="Error rate" value={formatPercent(s.errorRate)} tone={s.errorRate > 0.05 ? 'bad' : 'default'} />
        <MetricCard label="p95 latency" value={formatDuration(s.p95Ms)} tone={s.p95Ms > 1500 ? 'warn' : 'default'} />
        <MetricCard label="Queue depth" value={String(s.queueDepth)} tone={s.queueDepth > 50 ? 'warn' : 'default'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TimeSeries data={points} dataKey="p95Ms" label="p95 latency (15 min)" unit=" ms" />
        <TimeSeries data={points} dataKey="errorPct" label="Error rate (15 min)" color="var(--critical)" unit="%" />
        <TimeSeries data={points} dataKey="rps" label="Requests per second" color="var(--healthy)" />
        <TimeSeries data={points} dataKey="queueDepth" label="Queue depth" color="var(--warning)" />
      </div>

      <p className="text-sm text-muted">
        Investigate further:{' '}
        <Link href={`/traces?service=${s.id}`} className="text-accent hover:underline">traces through this service</Link>
        {' · '}
        <Link href="/alerts" className="text-accent hover:underline">related alerts</Link>
      </p>
    </div>
  );
}
