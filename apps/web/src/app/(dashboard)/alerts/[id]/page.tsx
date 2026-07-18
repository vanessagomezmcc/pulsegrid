'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { AlertOccurrence } from '@pulsegrid/shared-types';
import { ErrorState, Loading } from '@/components/DataState';
import { api } from '@/lib/api';

export default function AlertDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['alerts', id], queryFn: () => api<AlertOccurrence>(`/api/alerts/${id}`) });
  if (q.isLoading) return <Loading label="Loading alert…" />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const a = q.data;
  if (!a) return null;

  const timeline = [
    { label: 'Condition first breached (pending)', at: a.startedAt },
    { label: 'Fired after sustained breach', at: a.firingAt },
    { label: 'Acknowledged by operator', at: a.acknowledgedAt },
    { label: 'Resolved — condition cleared', at: a.resolvedAt },
  ].filter((t) => t.at);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/alerts" className="text-xs text-muted hover:text-fg">← All alerts</Link>
        <h1 className="mt-1 text-xl font-semibold">{a.ruleName}</h1>
        <p className="mt-1 text-sm text-muted">{a.description}</p>
      </div>
      <div className="card p-5">
        <dl className="mono grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs uppercase text-muted">State</dt><dd>{a.state}</dd></div>
          <div><dt className="text-xs uppercase text-muted">Severity</dt><dd>{a.severity}</dd></div>
          <div><dt className="text-xs uppercase text-muted">Metric</dt><dd>{a.metric}</dd></div>
          <div><dt className="text-xs uppercase text-muted">Last value / threshold</dt><dd>{a.value.toFixed(2)} / {a.threshold}</dd></div>
          <div><dt className="text-xs uppercase text-muted">Service</dt><dd>{a.serviceName ?? 'system-wide'}</dd></div>
          {a.incidentId && (
            <div>
              <dt className="text-xs uppercase text-muted">Incident</dt>
              <dd><Link href={`/incidents/${a.incidentId}`} className="text-accent hover:underline">{a.incidentId}</Link></dd>
            </div>
          )}
        </dl>
      </div>
      <div className="card p-5">
        <h2 className="mb-3 text-sm font-medium">Lifecycle</h2>
        <ol className="space-y-2 border-l border-border pl-4 text-sm">
          {timeline.map((t) => (
            <li key={t.label}>
              <p>{t.label}</p>
              <p className="mono text-xs text-muted">{new Date(t.at as string).toLocaleString()}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
