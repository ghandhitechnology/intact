'use client';

import { ReactNode, useEffect } from 'react';

const CACHE_COOKIE = 'intact_cache_scope';
const STORAGE_PREFIX = 'intact:resource:v1:';
const CHANNEL_NAME = 'intact-session';

function cookieValue(name: string) {
  if (typeof document === 'undefined') return '';
  const prefix = `${name}=`;
  const value = document.cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(prefix));
  try {
    return value ? decodeURIComponent(value.slice(prefix.length)) : '';
  } catch {
    return '';
  }
}

function resourceStorageKey(resource: string) {
  const scope = cookieValue(CACHE_COOKIE);
  return scope ? `${STORAGE_PREFIX}${scope}:${encodeURIComponent(resource)}` : '';
}

export function getCachedResource<T>(resource: string, maxAgeMs: number): T | null {
  if (typeof window === 'undefined') return null;
  const key = resourceStorageKey(resource);
  if (!key) return null;
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) || 'null') as { savedAt?: number; data?: T } | null;
    if (!cached?.savedAt || Date.now() - cached.savedAt > maxAgeMs || cached.data === undefined) return null;
    return cached.data;
  } catch {
    try { sessionStorage.removeItem(key); } catch { /* 저장소가 차단된 경우 캐시를 생략합니다. */ }
    return null;
  }
}

export function setCachedResource<T>(resource: string, data: T) {
  if (typeof window === 'undefined') return;
  const key = resourceStorageKey(resource);
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // Cache storage is optional; live fetching remains available.
  }
}

export function clearClientDataCache(notify = true) {
  if (typeof window === 'undefined') return;
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(STORAGE_PREFIX) || key?.startsWith('intact:chat:v1:')) sessionStorage.removeItem(key);
    }
  } catch {
    // 브라우저가 저장소 접근을 차단해도 로그인과 모드 전환을 계속합니다.
  }
  if (notify && 'BroadcastChannel' in window) {
    try {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage({ type: 'clear' });
      channel.close();
    } catch {
      // 탭 간 통신도 브라우저의 개인정보 설정에 따라 차단될 수 있습니다.
    }
  }
}

export default function ClientDataProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      if ('BroadcastChannel' in window) channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      // 탭 간 통신이 차단되어도 현재 탭의 세션과 캐시는 계속 관리합니다.
    }
    channel?.addEventListener('message', (event) => {
      if (event.data?.type === 'clear') clearClientDataCache(false);
    });
    return () => channel?.close();
  }, []);
  return <>{children}</>;
}
