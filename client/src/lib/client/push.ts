import { fetchWithTimeout } from './request';

export async function rebindPushSubscription() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await fetchWithTimeout('/api/notifications/push-subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...subscription.toJSON(), reassign: true }),
    });
  } catch {
    // Rebinding is best effort; the user can re-enable notifications from settings.
  }
}
