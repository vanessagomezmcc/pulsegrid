'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { Span, TraceSummary } from '@pulsegrid/shared-types';
import { formatDuration } from '@pulsegrid/ui';
import { ErrorState, Loading } from '@/components/DataState';
import { TraceWaterfall } from '@/components/TraceWaterfall';
import { api } from '@/lib/api';

interface TraceDetail {
  trace: TraceSummary & { endedAt: string };
  spans: Span[];
}

export default function TraceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['traces', id], queryFn: () => api<TraceDetail>(`/api/traces/${id}`) });
  if (q.isLoading) return <Loading label="Loading trace…" />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d) return null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/traces" className="text-xs text-muted hover:text-fg">← All traces</Link>
        <h1 className="mono mt-1 break-all text-lg font-semibold">{d.trace.traceId}</h1>
        <p className="mt-1 text-sm text-muted">
          {d.trace.rootService} <span className="mono">{d.trace.rootEndpoint}</span> ·{' '}
          {formatDuration(d.trace.durationMs)} · {d.trace.spanCount} spans ·{' '}
          <span className={d.trace.status === 'ok' ? 'text-healthy' : 'text-critical'}>{d.trace.status}</span>
        </p>
      </div>
      <TraceWaterfall
        spans={d.spans}
        traceStart={new Date(d.trace.startedAt).getTime()}
        traceDurationMs={d.trace.durationMs}
      />
      <p className="text-xs text-muted">
        Bars are positioned on real span start offsets and durations. Skipped spans mark work the
        chain never reached because an upstream hop failed first.
      </p>
    </div>
  );
}
