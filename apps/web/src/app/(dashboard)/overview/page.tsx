'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { Incident, LiveMessage, ServiceSummary } from '@pulsegrid/shared-types';
import { StatusDot, formatDuration, formatPercent } from '@pulsegrid/ui';
import { Empty, ErrorState, Loading } from '@/components/DataState';
import { MetricCard } from '@/components/MetricCard';
import { api } from '@/lib/api';

interface LiveTotals {
  totals?: { rps: number; errorRate: number; p95Ms: number; deadLetter1m: number; requests60s: number };
}

export default function OverviewPage() {
  const services = useQuery({ queryKey: ['services'], queryFn: () => api<ServiceSummary[]>('/api/services') });
  const incidents = useQuery({ queryKey: ['incidents'], queryFn: () => api<Incident[]>('/api/incidents') });
  const live = useQuery<LiveMessage<LiveTotals>>({ queryKey: ['live', 'metrics'], enabled: false });

  if (services.isLoading) return <Loading label="Loading system overview…" />;
  if (services.isError) return <ErrorState message={(services.error as Error).message} onRetry={() => void services.refetch()} />;

  const totals = live.data?.payload?.totals;
  const open = (incidents.data ?? []).filter((i) => i.status === 'open' && !i.isSeed);
  const worst = (services.data ?? []).reduce<string>((acc, s) => {
    const rank = { critical: 4, offline: 4, degraded: 3, unknown: 2, healthy: 1 } as const;
    return rank[s.health] > rank[(acc as keyof typeof rank) ?? 'healthy'] ? s.health : acc;
  }, 'healthy');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">System Overview</h1>
        <StatusDot state={worst as ServiceSummary['health']} pulse />
      </div>

      {open.length > 0 && (
        <Link href={`/incidents/${open[0]?.id}`} className="card block border-critical/50 p-4 hover:border-critical">
          <p className="text-sm font-medium text-critical">Active incident: {open[0]?.title}</p>
          <p className="mt-0.5 text-xs text-muted">Click to open the incident timeline and root-cause analysis.</p>
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Throughput" value={totals ? `${totals.rps.toFixed(1)} rps` : '—'} sub={totals ? `${totals.requests60s} requests / 60 s` : 'awaiting live data'} />
        <MetricCard label="Error rate" value={totals ? formatPercent(totals.errorRate) : '—'} tone={totals && totals.errorRate > 0.05 ? 'bad' : 'default'} />
        <MetricCard label="p95 latency" value={totals ? formatDuration(totals.p95Ms) : '—'} tone={totals && totals.p95Ms > 1500 ? 'warn' : 'default'} />
        <MetricCard label="Dead letters (1 m)" value={totals ? String(totals.deadLetter1m) : '—'} tone={totals && totals.deadLetter1m > 5 ? 'warn' : 'default'} />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted">Services</h2>
        {services.data && services.data.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {services.data.map((s) => (
              <Link key={s.id} href={`/services/${s.id}`} className="card block p-4 transition-colors hover:border-accent">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{s.displayName}</p>
                  <StatusDot state={s.health} pulse />
                </div>
                <p className="mono mt-2 grid grid-cols-4 gap-2 text-xs text-muted">
                  <span>{s.rps.toFixed(1)} rps</span>
                  <span>{formatPercent(s.errorRate)} err</span>
                  <span>p95 {formatDuration(s.p95Ms)}</span>
                  <span>{s.queueDepth > 0 ? `queue ${s.queueDepth}` : '—'}</span>
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <Empty title="No services reporting yet" hint="Telemetry appears within a few seconds of the pipeline starting." />
        )}
      </section>
    </div>
  );
}
