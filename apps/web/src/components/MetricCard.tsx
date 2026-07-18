export function MetricCard({
  label, value, sub, tone = 'default',
}: {
  label: string; value: string; sub?: string; tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  const toneClass =
    tone === 'good' ? 'text-healthy' : tone === 'warn' ? 'text-warning' : tone === 'bad' ? 'text-critical' : '';
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={`mono mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}
