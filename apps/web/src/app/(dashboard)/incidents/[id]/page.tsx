'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { Incident, IncidentEvent } from '@pulsegrid/shared-types';
import { formatDuration } from '@pulsegrid/ui';
import { ErrorState, Loading } from '@/components/DataState';
import { api } from '@/lib/api';

const kindColor: Record<string, string> = {
  alert_firing: 'bg-critical', alert_resolved: 'bg-healthy', health_transition: 'bg-warning',
  recovery: 'bg-accent', resolved: 'bg-healthy', queue_growth: 'bg-warning', scenario: 'bg-accent',
};

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ['incidents', id],
    queryFn: () => api<{ incident: Incident; timeline: IncidentEvent[] }>(`/api/incidents/${id}`),
    refetchInterval: 5000,
  });
  if (q.isLoading) return <Loading label="Loading incident…" />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d) return null;
  const { incident: i, timeline } = d;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/incidents" className="text-xs text-muted hover:text-fg">← All incidents</Link>
        <h1 className="mt-1 text-xl font-semibold">{i.title}</h1>
        <p className="mt-1 text-sm">
          <span className={i.status === 'open' ? 'text-critical' : 'text-healthy'}>{i.status.toUpperCase()}</span>
          <span className="text-muted"> · severity {i.severity}
            {i.detectionMs !== null && <> · time to detect {formatDuration(i.detectionMs)}</>}
            {i.durationMs !== null && <> · duration {formatDuration(i.durationMs)}</>}
          </span>
        </p>
      </div>

      {i.rootCauseService && (
        <div className="card border-accent/40 p-5">
          <h2 className="text-sm font-medium">Root-cause analysis (deterministic)</h2>
          <p className="mono mt-1 text-sm text-accent">{i.rootCauseService}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{i.rootCauseHint}</p>
        </div>
      )}

      <div className="card p-5">
        <h2 className="mb-4 text-sm font-medium">Timeline</h2>
        <ol className="space-y-3 border-l border-border pl-5">
          {timeline.map((t) => (
            <li key={t.id} className="relative">
              <span className={`absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ${kindColor[t.kind] ?? 'bg-muted'}`} aria-hidden />
              <p className="text-sm">{t.message}</p>
              <p className="mono mt-0.5 text-xs text-muted">
                {new Date(t.ts).toLocaleTimeString()} · {t.kind}
                {t.alertId && <> · <Link href={`/alerts/${t.alertId}`} className="text-accent hover:underline">view alert</Link></>}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
