'use client';
import { useSession } from './session';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? API_BASE.replace(/^http/, 'ws') + '/ws';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Session-aware fetch wrapper used by every TanStack Query hook. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const sessionId = useSession.getState().sessionId;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionId ? { 'x-pulsegrid-session': sessionId } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 404 && sessionId && path !== '/api/demo/sessions') {
    // Session may have expired server-side.
    const body = (await res.clone().json().catch(() => null)) as { message?: string } | null;
    if (body?.message?.includes('session')) useSession.getState().clear();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(res.status, body?.message ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function createSession(): Promise<{ id: string; expiresAt: string }> {
  const res = await fetch(`${API_BASE}/api/demo/sessions`, { method: 'POST' });
  if (!res.ok) throw new ApiError(res.status, 'Could not create a demo session.');
  return (await res.json()) as { id: string; expiresAt: string };
}
