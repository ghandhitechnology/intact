'use client';

import { ReactNode, useEffect } from 'react';

const CACHE_COOKIE = 'intact_cache_scope';
const STORAGE_PREFIX = 'intact:resource:v1:';
const CHANNEL_NAME = 'intact-session';

function cookieValue(name: string) {
  if (typeof document === 'undefined') return '';
  const prefix = `${name}=`;
  const value = document.cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : '';
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
    sessionStorage.removeItem(key);
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
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith(STORAGE_PREFIX) || key?.startsWith('intact:chat:v1:')) sessionStorage.removeItem(key);
  }
  if (notify && 'BroadcastChannel' in window) {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ type: 'clear' });
    channel.close();
  }
}

export default function ClientDataProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;
    channel?.addEventListener('message', (event) => {
      if (event.data?.type === 'clear') clearClientDataCache(false);
    });
    return () => channel?.close();
  }, []);
  return <>{children}</>;
}
