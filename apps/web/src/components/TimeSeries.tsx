'use client';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

export interface SeriesPoint {
  ts: string;
  [key: string]: string | number;
}

/** Restrained dark-theme time series used across the dashboard. */
export function TimeSeries({
  data, dataKey, label, color = 'var(--accent)', unit = '',
}: {
  data: SeriesPoint[]; dataKey: string; label: string; color?: string; unit?: string;
}) {
  return (
    <div className="card p-4">
      <p className="mb-2 text-xs uppercase tracking-wide text-muted">{label}</p>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
            <defs>
              <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="ts"
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              tickFormatter={(v: string) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              stroke="var(--border)"
            />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} stroke="var(--border)" width={54} />
            <Tooltip
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: 'var(--text-muted)' }}
              formatter={(value: number | string) => [`${typeof value === 'number' ? value.toFixed(1) : value}${unit}`, label]}
              labelFormatter={(v: string) => new Date(v).toLocaleTimeString()}
            />
            <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.8} fill={`url(#grad-${dataKey})`} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
