'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { scenarios } from '@pulsegrid/config';
import { ErrorState, Loading } from '@/components/DataState';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

interface SimState {
  flags: { activeScenario?: string; intensity?: number } | null;
  runs: { id: string; scenarioId: string; status: string; startedAt: string }[];
}

const guides: Record<string, string> = {
  'payment-slowdown': 'Watch: Services → Payments p95 climbs; Alerts → "Payment p95 latency high" goes pending, then fires; Incidents opens automatically.',
  'payment-error-spike': 'Watch: error rate on the Overview; failed traces in Traces; the error-rate alert firing.',
  'notification-outage': 'Watch: orders keep succeeding while notification retries fail; Dead-Letter Queue fills; the no-success alert fires.',
  'order-db-delay': 'Watch: order-service p95 on its detail page; upstream checkout latency in Traces waterfalls.',
  'traffic-surge': 'Watch: throughput ramps over 20 s on the Overview; queue depth on Notifications.',
  'queue-worker-pause': 'Watch: queue depth grows on the Notifications service page; backlog alert fires; recovery drains it.',
  'malformed-event': 'Watch: a new entry appears in the Dead-Letter Queue with its schema violations listed.',
  'full-recovery': 'Watch: alerts resolve, the incident closes with a full timeline, services return to healthy.',
  'normal-traffic': 'Baseline steady state — useful after experiments to compare against.',
};

export default function LabPage() {
  const queryClient = useQueryClient();
  const sessionId = useSession((s) => s.sessionId);
  const [intensity, setIntensity] = useState(2);
  const [msg, setMsg] = useState<string | null>(null);

  const state = useQuery({ queryKey: ['simulation'], queryFn: () => api<SimState>('/api/simulation/state'), refetchInterval: 5000 });
  const start = useMutation({
    mutationFn: (id: string) => api(`/api/simulation/scenarios/${id}/start`, { method: 'POST', body: JSON.stringify({ intensity }) }),
    onSuccess: (_d, id) => {
      setMsg(`Scenario "${scenarios.find((s) => s.id === id)?.name}" started. ${guides[id] ?? ''}`);
      void queryClient.invalidateQueries({ queryKey: ['simulation'] });
    },
    onError: (err) => setMsg((err as Error).message),
  });
  const reset = useMutation({
    mutationFn: () => api(`/api/demo/sessions/${sessionId}/reset`, { method: 'POST' }),
    onSuccess: () => {
      setMsg('Environment reset: scenarios cleared, queues emptied, session data wiped.');
      void queryClient.invalidateQueries();
    },
    onError: (err) => setMsg((err as Error).message),
  });

  if (state.isLoading) return <Loading label="Loading simulation state…" />;
  if (state.isError) return <ErrorState message={(state.error as Error).message} onRetry={() => void state.refetch()} />;
  const active = state.data?.flags?.activeScenario;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Simulation Lab</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Scenarios change real backend behavior for your session only — injected latency is real
            latency, failures are real failures. Everything downstream (health, alerts, incidents)
            is derived from measured telemetry.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-muted">
            Intensity{' '}
            <select value={intensity} onChange={(e) => setIntensity(Number(e.target.value))}
              className="ml-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm">
              <option value={1}>1 · mild</option><option value={2}>2 · moderate</option><option value={3}>3 · severe</option>
            </select>
          </label>
          <button onClick={() => reset.mutate()} disabled={reset.isPending}
            className="rounded-md border border-critical/60 px-3 py-1.5 text-sm text-critical hover:bg-critical/10 disabled:opacity-50">
            Reset environment
          </button>
        </div>
      </div>

      {active && active !== 'normal-traffic' && (
        <p className="card border-warning/50 p-3 text-sm">
          <span className="text-warning">Active scenario:</span>{' '}
          <span className="mono">{active}</span> — run <span className="mono">full-recovery</span> to clear it.
        </p>
      )}
      {msg && <p className="card border-accent/40 p-3 text-sm text-muted" role="status">{msg}</p>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {scenarios.map((s) => (
          <div key={s.id} className={`card flex flex-col p-4 ${active === s.id ? 'border-accent' : ''}`}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{s.name}</h2>
              <span className="rounded bg-bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">{s.category}</span>
            </div>
            <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted">{s.description}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted/80">{guides[s.id]}</p>
            <button onClick={() => start.mutate(s.id)} disabled={start.isPending}
              className="mt-3 rounded-md border border-border py-1.5 text-sm transition-colors hover:border-accent disabled:opacity-50">
              {active === s.id ? 'Adjust intensity / restart' : 'Run scenario'}
            </button>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted">
        Guided demo: run <span className="mono">payment-slowdown</span>, watch the{' '}
        <Link href="/overview" className="text-accent hover:underline">Overview</Link> and{' '}
        <Link href="/alerts" className="text-accent hover:underline">Alerts</Link> react, open the incident when it
        appears, then finish with <span className="mono">full-recovery</span>.
      </p>
    </div>
  );
}
