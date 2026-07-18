'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { DeadLetterEvent } from '@pulsegrid/shared-types';
import { formatRelative } from '@pulsegrid/ui';
import { Empty, ErrorState, Loading } from '@/components/DataState';
import { api } from '@/lib/api';

const statusTone: Record<string, string> = {
  failed: 'text-critical', retrying: 'text-warning', resolved: 'text-healthy', discarded: 'text-muted',
};

export default function DeadLetterPage() {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['dead-letter'], queryFn: () => api<DeadLetterEvent[]>('/api/dead-letter'), refetchInterval: 6000 });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'retry' | 'discard' }) =>
      api<{ detail?: string }>(`/api/dead-letter/${id}/${action}`, { method: 'POST' }),
    onSuccess: (res) => {
      setActionMsg(res.detail ?? 'Done.');
      void queryClient.invalidateQueries({ queryKey: ['dead-letter'] });
    },
    onError: (err) => setActionMsg((err as Error).message),
  });

  if (q.isLoading) return <Loading label="Loading dead-letter queue…" />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const rows = q.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dead-Letter Queue</h1>
        <p className="mt-1 text-sm text-muted">
          Nothing is silently dropped: schema-invalid telemetry and exhausted notification
          deliveries land here with their full payload and failure reason. Retry performs the real
          operation again.
        </p>
      </div>
      {actionMsg && (
        <p className="card border-accent/40 p-3 text-sm text-muted" role="status">{actionMsg}</p>
      )}
      {rows.length === 0 ? (
        <Empty title="Dead-letter queue is empty"
          hint="Run the Malformed Event or Notification Outage scenario to populate it." />
      ) : (
        <div className="space-y-3">
          {rows.map((e) => (
            <div key={e.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="mono text-sm">{e.kind}</span>
                  <span className={`ml-3 text-xs font-medium ${statusTone[e.status]}`}>{e.status}</span>
                  {e.isSeed && <span className="ml-2 rounded bg-bg-secondary px-1.5 py-0.5 text-[10px] text-muted">seed</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setOpenId(openId === e.id ? null : e.id)}
                    className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-accent">
                    {openId === e.id ? 'Hide payload' : 'Inspect'}
                  </button>
                  {!e.isSeed && (e.status === 'failed' || e.status === 'retrying') && (
                    <>
                      <button onClick={() => act.mutate({ id: e.id, action: 'retry' })} disabled={act.isPending}
                        className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-healthy disabled:opacity-50">
                        Retry
                      </button>
                      <button onClick={() => act.mutate({ id: e.id, action: 'discard' })} disabled={act.isPending}
                        className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-critical disabled:opacity-50">
                        Discard
                      </button>
                    </>
                  )}
                </div>
              </div>
              <p className="mt-2 text-sm text-muted">{e.failureReason}</p>
              <p className="mono mt-1 text-xs text-muted">
                first failed {formatRelative(e.firstFailureAt)} · retries {e.retryCount} · source {e.sourceTopic}
              </p>
              {openId === e.id && (
                <div className="mt-3 space-y-2">
                  <pre className="mono overflow-x-auto rounded-md bg-bg p-3 text-xs leading-relaxed">
                    {formatPayload(e.originalPayload)}
                  </pre>
                  {e.validationErrors && e.validationErrors.length > 0 && (
                    <ul className="list-inside list-disc text-xs text-critical">
                      {e.validationErrors.map((v) => <li key={v}>{v}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatPayload(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
