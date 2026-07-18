/**
 * PulseGrid mark: a 3x3 node grid with a pulse line crossing it — telemetry
 * moving through a system. Original geometry, no stock icon parts.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      {[6, 16, 26].flatMap((x) =>
        [6, 16, 26].map((y) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={2.1} fill="var(--border)" />
        )),
      )}
      <path
        d="M2 20 L10 20 L13 9 L18 26 L21 16 L30 16"
        stroke="var(--accent)"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={30} cy={16} r={2.6} fill="var(--accent)" />
    </svg>
  );
}

export function LogoFull({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark />
      {!compact && <span className="text-lg font-semibold tracking-tight">PulseGrid</span>}
    </span>
  );
}
