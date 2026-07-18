'use client';
import type { Span } from '@pulsegrid/shared-types';
import { formatDuration } from '@pulsegrid/ui';

const serviceColor: Record<string, string> = {
  'auth-service': 'var(--accent)',
  'payment-service': '#a78bfa',
  'order-service': 'var(--healthy)',
  'notification-service': 'var(--warning)',
};

/** Horizontal waterfall: spans positioned by real start offsets and durations. */
export function TraceWaterfall({ spans, traceStart, traceDurationMs }: {
  spans: Span[]; traceStart: number; traceDurationMs: number;
}) {
  const total = Math.max(traceDurationMs, 1);
  const depth = new Map<string, number>();
  for (const s of spans) {
    depth.set(s.spanId, s.parentSpanId ? (depth.get(s.parentSpanId) ?? 0) + 1 : 0);
  }
  return (
    <div className="card divide-y divide-border/50">
      {spans.map((s) => {
        const offset = Math.max(0, new Date(s.startedAt).getTime() - traceStart);
        const left = Math.min((offset / total) * 100, 99);
        const width = Math.max((s.durationMs / total) * 100, 0.6);
        const failed = s.status === 'error' || s.status === 'timeout';
        return (
          <div key={s.spanId} className="grid grid-cols-[240px_1fr_90px] items-center gap-3 px-4 py-2 text-xs">
            <div style={{ paddingLeft: (depth.get(s.spanId) ?? 0) * 14 }} className="truncate">
              <span className="font-medium">{s.serviceName}</span>
              <span className="ml-1.5 text-muted">{s.operation}</span>
              {failed && <span className="ml-1.5 text-critical">{s.errorType ?? s.status}</span>}
            </div>
            <div className="relative h-4 rounded bg-bg-secondary" role="img"
              aria-label={`${s.serviceName} ${s.operation}: ${formatDuration(s.durationMs)}${failed ? ', failed' : ''}`}>
              <div className="absolute top-0 h-4 rounded"
                style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`,
                  background: failed ? 'var(--critical)' : (serviceColor[s.serviceName] ?? 'var(--accent)'),
                  opacity: s.status === 'skipped' ? 0.35 : 0.9 }} />
            </div>
            <div className="mono text-right text-muted">{s.status === 'skipped' ? 'skipped' : formatDuration(s.durationMs)}</div>
          </div>
        );
      })}
    </div>
  );
}
