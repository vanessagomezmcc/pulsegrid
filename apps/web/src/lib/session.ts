'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SessionState {
  sessionId: string | null;
  expiresAt: string | null;
  setSession: (id: string, expiresAt: string) => void;
  clear: () => void;
}

/**
 * The demo session id is the only client-side state that must survive
 * reloads; it is a random capability token for an isolated sandbox, not a
 * credential for any real account.
 */
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      sessionId: null,
      expiresAt: null,
      setSession: (sessionId, expiresAt) => set({ sessionId, expiresAt }),
      clear: () => set({ sessionId: null, expiresAt: null }),
    }),
    { name: 'pulsegrid-session' },
  ),
);
