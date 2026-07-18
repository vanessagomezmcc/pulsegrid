'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { Incident } from '@pulsegrid/shared-types';
import { formatDuration, formatRelative } from '@pulsegrid/ui';
import { Empty, ErrorState, Loading } from '@/components/DataState';
import { api } from '@/lib/api';

export default function IncidentsPage() {
  const q = useQuery({ queryKey: ['incidents'], queryFn: () => api<Incident[]>('/api/incidents'), refetchInterval: 5000 });
  if (q.isLoading) return <Loading label="Loading incidents…" />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const rows = q.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Incidents</h1>
        <p className="mt-1 text-sm text-muted">
          Opened automatically when a critical alert fires; resolved when every alert clears and all
          services return to healthy. Root-cause hints come from deterministic dependency-graph
          correlation — the evidence is always shown.
        </p>
      </div>
      {rows.length === 0 ? (
        <Empty title="No incidents recorded"
          hint={<>Trigger a critical failure from the <Link href="/lab" className="text-accent hover:underline">Simulation Lab</Link> to watch the incident lifecycle end-to-end.</>} />
      ) : (
        <div className="space-y-3">
          {rows.map((i) => (
            <Link key={i.id} href={`/incidents/${i.id}`}
              className={`card block p-4 transition-colors hover:border-accent ${i.status === 'open' ? 'border-critical/50' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{i.title}</p>
                <span className={`text-xs font-medium ${i.status === 'open' ? 'text-critical' : 'text-healthy'}`}>
                  {i.status.toUpperCase()}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">
                Started {formatRelative(i.startedAt)}
                {i.durationMs !== null && <> · lasted {formatDuration(i.durationMs)}</>}
                {i.detectionMs !== null && <> · detected in {formatDuration(i.detectionMs)}</>}
                {i.rootCauseService && <> · root cause: <span className="mono">{i.rootCauseService}</span></>}
                {i.isSeed && <> · historical example</>}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
