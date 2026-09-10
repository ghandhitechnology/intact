'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { clearClientDataCache } from './ClientDataProvider';
import { onSessionExpired } from '@/lib/client/session-events';
import type { PortalSessionSnapshot } from '@/lib/contracts/portal-bootstrap';
export type { PortalSessionUser, PortalSessionSnapshot, ReverificationStatus } from '@/lib/contracts/portal-bootstrap';

type SessionContextValue = {
  session: PortalSessionSnapshot | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<PortalSessionSnapshot | undefined>;
};

const SessionContext = createContext<SessionContextValue | null>(null);
const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

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

export default function SessionProvider({ children, initialSession = null }: { children: ReactNode; initialSession?: PortalSessionSnapshot | null }) {
  const [session, setSession] = useState<PortalSessionSnapshot | null>(initialSession);
  const [loading, setLoading] = useState(initialSession === null);
  const hadInitialSession = useRef(initialSession !== null);
  const initialSessionRef = useRef(initialSession);
  const [error, setError] = useState<Error | null>(null);
  const latestRefresh = useRef<Promise<PortalSessionSnapshot | undefined> | null>(null);

  useClientLayoutEffect(() => {
    if (initialSessionRef.current?.authenticated === false) clearClientDataCache();
  }, []);

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
    if (!hadInitialSession.current) void refresh();
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
