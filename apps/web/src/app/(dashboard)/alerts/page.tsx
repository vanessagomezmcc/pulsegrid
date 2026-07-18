'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import type { AlertOccurrence } from '@pulsegrid/shared-types';
import { formatRelative } from '@pulsegrid/ui';
import { Empty, ErrorState, Loading } from '@/components/DataState';
import { api } from '@/lib/api';

const stateTone: Record<string, string> = {
  firing: 'text-critical', pending: 'text-warning', acknowledged: 'text-accent',
  resolved: 'text-healthy', inactive: 'text-muted',
};

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['alerts'], queryFn: () => api<AlertOccurrence[]>('/api/alerts'), refetchInterval: 5000 });
  const ack = useMutation({
    mutationFn: (id: string) => api(`/api/alerts/${id}/acknowledge`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });

  if (q.isLoading) return <Loading label="Loading alerts…" />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;

  const rows = q.data ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Alerts</h1>
        <p className="mt-1 text-sm text-muted">
          Rules evaluate every 5 s against your session's real telemetry: inactive → pending →
          firing → acknowledged → resolved.
        </p>
      </div>
      {rows.length === 0 ? (
        <Empty title="No alert activity yet"
          hint={<>Run a failure scenario in the <Link href="/lab" className="text-accent hover:underline">Simulation Lab</Link> and alerts will move through their lifecycle here.</>} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Rule</th><th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">State</th><th className="px-4 py-3">Value / threshold</th>
                <th className="px-4 py-3">Updated</th><th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-border/50 last:border-0 hover:bg-bg-secondary/50">
                  <td className="px-4 py-3">
                    <Link href={`/alerts/${a.id}`} className="font-medium hover:text-accent">{a.ruleName}</Link>
                    <p className="text-xs text-muted">{a.severity}</p>
                  </td>
                  <td className="mono px-4 py-3 text-xs">{a.serviceName ?? 'system'}</td>
                  <td className={`px-4 py-3 font-medium ${stateTone[a.state]}`}>{a.state}</td>
                  <td className="mono px-4 py-3 text-xs">{a.value.toFixed(1)} / {a.threshold}</td>
                  <td className="px-4 py-3 text-xs text-muted">{formatRelative(a.resolvedAt ?? a.firingAt ?? a.startedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {a.state === 'firing' && (
                      <button onClick={() => ack.mutate(a.id)} disabled={ack.isPending}
                        className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-accent disabled:opacity-50">
                        Acknowledge
                      </button>
                    )}
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
