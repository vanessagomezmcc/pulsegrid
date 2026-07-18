'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navigation } from '@pulsegrid/config';
import { LogoFull } from './Logo';
import { API_BASE } from '@/lib/api';

export function Sidebar({ liveStatus }: { liveStatus: 'connecting' | 'live' | 'offline' }) {
  const pathname = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-bg-secondary max-lg:hidden">
      <div className="px-4 py-4">
        <Link href="/" aria-label="PulseGrid home">
          <LogoFull />
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 px-2" aria-label="Primary">
        {navigation.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                active ? 'bg-surface text-fg' : 'text-muted hover:bg-surface hover:text-fg'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        <a
          href={`${API_BASE}/docs`}
          target="_blank"
          rel="noreferrer"
          className="block rounded-md px-3 py-2 text-sm text-muted hover:bg-surface hover:text-fg"
        >
          API Docs ↗
        </a>
      </nav>
      <div className="border-t border-border px-4 py-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${
              liveStatus === 'live' ? 'bg-healthy' : liveStatus === 'connecting' ? 'bg-warning' : 'bg-critical'
            }`}
            aria-hidden
          />
          {liveStatus === 'live' ? 'Live stream connected' : liveStatus === 'connecting' ? 'Connecting…' : 'Live stream offline'}
        </span>
      </div>
    </aside>
  );
}
