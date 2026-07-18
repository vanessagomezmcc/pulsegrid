'use client';

import { brand } from '@pulsegrid/config';
import { DEMO_MODE } from '@/lib/api';

export function DemoBanner() {
  return (
    <div className="border-b border-border bg-surface/80 px-4 py-2 text-center text-xs text-muted">
      {DEMO_MODE ? (
        <>
          Hosted portfolio demo — telemetry is simulated in your browser.{' '}
          <a
            href="https://github.com/vanessagomezmcc/pulsegrid"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            View the complete event-driven source ↗
          </a>
        </>
      ) : (
        brand.demoBanner
      )}
    </div>
  );
}
