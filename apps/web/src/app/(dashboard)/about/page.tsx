import { brand } from '@pulsegrid/config';

export default function AboutPage() {
  return (
    <div className="max-w-2xl space-y-6 text-sm leading-relaxed">
      <h1 className="text-xl font-semibold">About {brand.productName}</h1>
      <p className="text-muted">
        {brand.productName} is a portfolio project built to demonstrate distributed-systems and
        observability engineering with a running system rather than a slide. Everything on this
        dashboard is derived from real telemetry flowing through a real pipeline: four Go services,
        Redpanda event streaming, a stream processor, PostgreSQL, Redis, a NestJS control plane,
        and this Next.js frontend.
      </p>
      <p className="text-muted">
        What it is not: a production monitoring product, a benchmark, or an AI-driven AIOps demo.
        The failure scenarios are synthetic by design so that the interesting parts — trace
        propagation, health computation, alert lifecycles, incident correlation, dead-letter
        handling — can be exercised on demand and inspected honestly.
      </p>
      <p className="text-muted">
        The source, architecture decision records, data model, and a five-minute demo script are in
        the repository:{' '}
        <a href={brand.repositoryUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
          {brand.repositoryUrl.replace('https://', '')}
        </a>
        .
      </p>
      <p className="text-xs text-muted">
        Sessions are anonymous, isolated, rate-limited, and expire after 30 minutes of inactivity.
        High-volume telemetry is retained for two hours.
      </p>
    </div>
  );
}
