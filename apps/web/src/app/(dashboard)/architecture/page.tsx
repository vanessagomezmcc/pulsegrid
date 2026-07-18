import { dependencyEdges, serviceIds, serviceMeta } from '@pulsegrid/config';

const pipeline = [
  { name: 'Traffic Generator', role: 'Originates realistic synthetic requests with fresh W3C trace context per request (Go).' },
  { name: 'Service Chain', role: 'auth → payment → order → notification. Each hop emits telemetry to Redpanda and honors per-session failure flags read from Redis (Go).' },
  { name: 'Redpanda', role: 'Kafka-compatible event streaming: raw telemetry, processed metrics, alerts, incidents, and dead-letter topics.' },
  { name: 'Telemetry Processor', role: 'Validates, deduplicates, persists to PostgreSQL, computes health and metrics over sliding windows, evaluates alert rules, drives incidents, publishes live updates (Go).' },
  { name: 'Control-Plane API', role: 'NestJS + PostgreSQL/Redis: read APIs, demo sessions, scenario control, DLQ actions, and the WebSocket live gateway.' },
  { name: 'Dashboard', role: 'Next.js App Router + TanStack Query: everything you are looking at, fed by REST backfill and the live WebSocket stream.' },
];

export default function ArchitecturePage() {
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Architecture</h1>
        <p className="mt-1 text-sm text-muted">
          A functioning event-driven pipeline, deliberately small enough to read end-to-end.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted">Simulated service chain</h2>
        <div className="card flex flex-wrap items-center gap-2 p-5 text-sm">
          {serviceIds.map((id, idx) => (
            <span key={id} className="flex items-center gap-2">
              <span className="rounded-md border border-border bg-bg-secondary px-3 py-1.5">
                {serviceMeta[id].displayName}
                <span className="mono ml-1.5 text-xs text-muted">{id}</span>
              </span>
              {idx < serviceIds.length - 1 && <span className="text-muted" aria-hidden>→</span>}
            </span>
          ))}
        </div>
        <ul className="mt-3 space-y-1 text-xs text-muted">
          {dependencyEdges.map(([u, d]) => (
            <li key={`${u}${d}`} className="mono">{u} calls {d} over HTTP with propagated trace context</li>
          ))}
          <li className="mono">order-service → notification-service delivery is queued in Redis and drained by a background worker</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted">Data flow</h2>
        <ol className="space-y-3">
          {pipeline.map((p, i) => (
            <li key={p.name} className="card flex gap-4 p-4">
              <span className="mono text-sm text-accent">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <p className="text-sm font-medium">{p.name}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-muted">{p.role}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="text-sm leading-relaxed text-muted">
        <h2 className="mb-2 text-sm font-medium">Design positions worth knowing</h2>
        <p>
          Health is computed only from observed telemetry — services never self-report a status
          flag. Alerting is a small deterministic state machine (inactive → pending → firing →
          acknowledged → resolved) evaluated every five seconds. Incident root-cause hints come
          from timestamp-plus-dependency-graph correlation and always show their evidence. There is
          no LLM anywhere in the alerting or incident path, by design: the full rationale lives in{' '}
          <span className="mono">docs/DECISIONS.md</span>.
        </p>
      </section>
    </div>
  );
}
