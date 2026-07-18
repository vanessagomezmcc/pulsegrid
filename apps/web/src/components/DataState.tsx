'use client';
import type { ReactNode } from 'react';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="card flex items-center justify-center p-10 text-sm text-muted" role="status">
      <span className="mr-2 inline-block h-3 w-3 animate-pulse rounded-full bg-accent" aria-hidden />
      {label}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="card p-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card border-critical/40 p-8 text-center">
      <p className="text-sm text-critical">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent"
        >
          Try again
        </button>
      )}
    </div>
  );
}
