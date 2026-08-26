'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { clearClientDataCache } from './ClientDataProvider';

export type PortalSessionUser = {
  id: string;
  nickname?: string;
  realName?: string;
  studentCode?: string | null;
  profileImage?: string | null;
  level?: number;
};

export type ReverificationStatus =
  | { kind: 'current' }
  | { kind: 'warning'; dueAt: string; requiredAt: string }
  | { kind: 'grace'; dueAt: string; requiredAt: string };

export type PortalSessionSnapshot = {
  authenticated: boolean;
  reason?: string | null;
  user?: PortalSessionUser;
  currentIgk?: number;
  lifetimeIgk?: number;
  expiresAt?: string;
  reverification?: ReverificationStatus;
};

type SessionContextValue = {
  session: PortalSessionSnapshot | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<PortalSessionSnapshot | undefined>;
};

const SessionContext = createContext<SessionContextValue | null>(null);
let pendingSessionRequest: Promise<PortalSessionSnapshot> | null = null;

async function requestSession() {
  if (pendingSessionRequest) return pendingSessionRequest;
  pendingSessionRequest = fetch('/api/auth/session', { cache: 'no-store' })
    .then(async (response) => {
      const body = await response.json().catch(() => null);
      const data = body?.data ?? body;
      if (!response.ok || typeof data?.authenticated !== 'boolean') throw new Error('SESSION_CHECK_FAILED');
      return data as PortalSessionSnapshot;
    })
    .finally(() => { pendingSessionRequest = null; });
  return pendingSessionRequest;
}

export default function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PortalSessionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await requestSession();
      setSession(next);
      setError(null);
      if (!next.authenticated) clearClientDataCache();
      return next;
    } catch (cause) {
      const nextError = cause instanceof Error ? cause : new Error('SESSION_CHECK_FAILED');
      setError(nextError);
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    let lastRefresh = Date.now();
    const refreshIfNeeded = () => {
      if (Date.now() - lastRefresh < 15_000) return;
      lastRefresh = Date.now();
      void refresh();
    };
    window.addEventListener('focus', refreshIfNeeded);
    window.addEventListener('online', refreshIfNeeded);
    return () => {
      window.removeEventListener('focus', refreshIfNeeded);
      window.removeEventListener('online', refreshIfNeeded);
    };
  }, [refresh]);

  const value = useMemo(() => ({ session, loading, error, refresh }), [error, loading, refresh, session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function usePortalSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('usePortalSession must be used inside SessionProvider');
  return value;
}
