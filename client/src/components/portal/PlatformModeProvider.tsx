'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { clearClientDataCache } from './ClientDataProvider';

type PlatformModeSnapshot = {
  bSideEnabled: boolean;
  maintenanceEnabled?: boolean;
  version: string;
};

type PlatformModeContextValue = PlatformModeSnapshot & {
  refresh: () => Promise<PlatformModeSnapshot | undefined>;
};

const PlatformModeContext = createContext<PlatformModeContextValue | null>(null);
const MODE_STORAGE_KEY = 'intact:platform-mode:v1';

function applyDocumentMode(enabled: boolean) {
  document.documentElement.classList.toggle('b-side', enabled);
  document.documentElement.dataset.platformSide = enabled ? 'b' : 'a';
}

async function requestPlatformMode() {
  const response = await fetch('/api/platform', { cache: 'no-store' });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.data || typeof body.data.bSideEnabled !== 'boolean') {
    throw new Error('PLATFORM_MODE_UNAVAILABLE');
  }
  return body.data as PlatformModeSnapshot;
}

export default function PlatformModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<PlatformModeSnapshot | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const currentRef = useRef<PlatformModeSnapshot | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await requestPlatformMode();
      // Push already-connected SPA users out as soon as maintenance turns on.
      // Admin pages stay reachable so the operator can turn it back off.
      if (next.maintenanceEnabled) {
        const path = window.location.pathname;
        if (!path.startsWith('/admin') && path !== '/maintenance') {
          window.location.replace('/maintenance');
          return next;
        }
      }
      const current = currentRef.current;
      const storedVersion = sessionStorage.getItem(MODE_STORAGE_KEY);
      applyDocumentMode(next.bSideEnabled);
      if ((!current && next.bSideEnabled && storedVersion !== next.version) || (current && current.version !== next.version)) {
        clearClientDataCache();
      }
      sessionStorage.setItem(MODE_STORAGE_KEY, next.version);
      currentRef.current = next;
      setUnavailable(false);
      setMode(next);
      if (current && current.version !== next.version) {
        window.location.reload();
      }
      return next;
    } catch {
      // Fail closed: cached real-name data must not appear when mode state is unknown.
      applyDocumentMode(true);
      clearClientDataCache(false);
      setUnavailable(true);
      return undefined;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const value = useMemo(
    () => mode ? { ...mode, refresh } : null,
    [mode, refresh],
  );

  if (!value || unavailable) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[var(--surface-muted)] text-xs font-bold text-[var(--ink-soft)]">
        {unavailable ? '보안 모드를 확인하는 중' : '인텍트 여는 중'}
      </div>
    );
  }

  return <PlatformModeContext.Provider value={value}>{children}</PlatformModeContext.Provider>;
}

export function usePlatformMode() {
  const value = useContext(PlatformModeContext);
  if (!value) throw new Error('usePlatformMode must be used inside PlatformModeProvider');
  return value;
}
