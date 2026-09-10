'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { clearClientDataCache } from './ClientDataProvider';
import { onSessionExpired } from '@/lib/client/session-events';

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

async function requestSession() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch('/api/auth/session', { cache: 'no-store', signal: controller.signal });
    const body = await response.json().catch(() => null);
    const data = body?.data ?? body;
    if (!response.ok || typeof data?.authenticated !== 'boolean') throw new Error('SESSION_CHECK_FAILED');
    return data as PortalSessionSnapshot;
  } finally {
    clearTimeout(timer);
  }
}

export default function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PortalSessionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const latestRefresh = useRef<Promise<PortalSessionSnapshot | undefined> | null>(null);

  const refresh = useCallback(() => {
    const pending: Promise<PortalSessionSnapshot | undefined> = requestSession()
      .then((next) => {
        // 로그인 이후 이동도 가장 최근 세션 확인이 끝날 때까지 기다립니다.
        if (latestRefresh.current !== pending) return latestRefresh.current ?? undefined;
        setSession(next);
        setError(null);
        if (!next.authenticated) clearClientDataCache();
        return next;
      })
      .catch((cause) => {
        if (latestRefresh.current !== pending) return latestRefresh.current ?? undefined;
        const nextError = cause instanceof Error ? cause : new Error('SESSION_CHECK_FAILED');
        setError(nextError);
        return undefined;
      })
      .finally(() => {
        if (latestRefresh.current === pending) setLoading(false);
      });
    latestRefresh.current = pending;
    return pending;
  }, []);

  useEffect(() => onSessionExpired(() => { void refresh(); }), [refresh]);

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
