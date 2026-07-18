'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
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
  if (
    !response.ok
    || !body?.data
    || typeof body.data.bSideEnabled !== 'boolean'
    || typeof body.data.maintenanceEnabled !== 'boolean'
    || typeof body.data.version !== 'string'
    || !body.data.version
  ) {
    throw new Error('PLATFORM_MODE_UNAVAILABLE');
  }
  return body.data as PlatformModeSnapshot;
}

function storedModeVersion() {
  try {
    return window.sessionStorage.getItem(MODE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeModeVersion(version: string) {
  try {
    window.sessionStorage.setItem(MODE_STORAGE_KEY, version);
  } catch {
    // Storage may be disabled by the browser. The in-memory mode still remains safe.
  }
}

export default function PlatformModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<PlatformModeSnapshot | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const currentRef = useRef<PlatformModeSnapshot | null>(null);

  const refresh = useCallback(async () => {
    setRetrying(true);
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
      const storedVersion = storedModeVersion();
      applyDocumentMode(next.bSideEnabled);
      if ((!current && next.bSideEnabled && storedVersion !== next.version) || (current && current.version !== next.version)) {
        clearClientDataCache();
      }
      storeModeVersion(next.version);
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
    } finally {
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    const realtimeBase = (process.env.NEXT_PUBLIC_REALTIME_URL || window.location.origin).replace(/\/$/, '');
    const socket = io(`${realtimeBase}/platform`, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
    socket.on('platform:invalidate', (message: { version?: unknown }) => {
      if (typeof message?.version === 'string' && message.version !== currentRef.current?.version) {
        void refresh();
      }
    });

    return () => {
      socket.disconnect();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const value = useMemo(
    () => mode ? { ...mode, refresh } : null,
    [mode, refresh],
  );

  if (unavailable) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[var(--surface-muted)] px-5 text-[var(--ink)]" role="alert">
        <div className="w-full max-w-sm border-t-2 border-[var(--line-strong)] bg-[var(--surface)] px-5 py-6 text-center">
          <p className="text-base font-bold">보안 설정을 확인할 수 없어요.</p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
            개인정보 보호를 위해 화면을 잠시 잠갔어요. 연결을 확인한 뒤 다시 시도해 주세요.
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={retrying}
            className="mt-5 min-h-10 bg-[var(--green)] px-5 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60"
          >
            {retrying ? '다시 확인 중…' : '다시 시도'}
          </button>
        </div>
      </div>
    );
  }

  if (!value) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[var(--surface-muted)] text-xs font-bold text-[var(--ink-soft)]">
        인텍트 여는 중
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
