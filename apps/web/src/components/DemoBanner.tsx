import { brand } from '@pulsegrid/config';

export function DemoBanner() {
  return (
    <div className="border-b border-border bg-bg-secondary px-4 py-1.5 text-center text-xs text-muted">
      {brand.demoBanner}
    </div>
  );
}
