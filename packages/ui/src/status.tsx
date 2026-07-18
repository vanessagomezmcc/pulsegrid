import type { HealthState } from '@pulsegrid/shared-types';

const stateColor: Record<HealthState, string> = {
  healthy: 'var(--healthy)',
  degraded: 'var(--warning)',
  critical: 'var(--critical)',
  offline: 'var(--critical)',
  unknown: 'var(--unknown)',
};

export function healthLabel(state: HealthState): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

/**
 * Colored status indicator that never relies on color alone: it pairs the dot
 * with a text label and exposes the state to screen readers.
 */
export function StatusDot({ state, pulse = false }: { state: HealthState; pulse?: boolean }) {
  return (
    <span className="status-dot-wrap" role="status" aria-label={`Status: ${healthLabel(state)}`}>
      <span
        className={pulse && (state === 'degraded' || state === 'critical') ? 'status-dot status-dot--pulse' : 'status-dot'}
        style={{ backgroundColor: stateColor[state] }}
        aria-hidden="true"
      />
      <span className="status-dot-label">{healthLabel(state)}</span>
    </span>
  );
}
