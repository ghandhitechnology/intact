export const SESSION_EXPIRED_EVENT = 'intact:session-expired';

export function notifySessionExpired() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

export function onSessionExpired(listener: () => void) {
  window.addEventListener(SESSION_EXPIRED_EVENT, listener);
  return () => window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
}
