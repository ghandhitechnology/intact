import type { PrismaClient } from '@prisma/client';
import webPush from 'web-push';
import { decryptText } from './crypto';

let configured = false;

function configureWebPush() {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject || !/^(?:mailto:|https:\/\/)/.test(subject)) {
    throw new Error('Web Push VAPID configuration is incomplete');
  }
  webPush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

function decryptStored(value: string) {
  return value.startsWith('v1.') ? decryptText(value) : value;
}

function safeHref(value: unknown) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value.slice(0, 2_048)
    : '/notifications';
}

export type NotificationDeliveryPayload = {
  notificationId?: string | null;
  userId: string;
  type: string;
  href?: string | null;
  mandatory?: boolean;
};

export async function deliverNotificationPush(
  prisma: PrismaClient,
  payload: NotificationDeliveryPayload,
  options: {
    sendNotification?: typeof webPush.sendNotification;
  } = {},
) {
  if (!options.sendNotification) configureWebPush();
  const sendNotification = options.sendNotification ?? webPush.sendNotification.bind(webPush);
  if (!payload.userId || typeof payload.userId !== 'string') {
    throw new Error('Push delivery payload has no userId');
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: {
      userId: payload.userId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (!subscriptions.length) return;

  const body = JSON.stringify({
    title: '인텍트 알림',
    body: '새 알림이 도착했습니다. 인텍트에서 확인해 주세요.',
    href: safeHref(payload.href),
  });
  let transientFailures = 0;

  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await sendNotification(
        {
          endpoint: decryptStored(subscription.endpoint),
          keys: {
            p256dh: decryptStored(subscription.p256dh),
            auth: decryptStored(subscription.auth),
          },
        },
        body,
        {
          TTL: payload.mandatory ? 86_400 : 3_600,
          urgency: payload.mandatory ? 'high' : 'normal',
          ...(payload.notificationId
            ? { topic: payload.notificationId.replace(/-/g, '').slice(0, 32) }
            : {}),
        },
      );
      await prisma.pushSubscription.update({
        where: { id: subscription.id },
        data: { failureCount: 0, lastFailureAt: null },
      });
    } catch (error) {
      const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : 0;
      if (statusCode === 404 || statusCode === 410) {
        await prisma.pushSubscription.update({
          where: { id: subscription.id },
          data: { revokedAt: new Date(), lastFailureAt: new Date(), failureCount: { increment: 1 } },
        });
        return;
      }
      transientFailures += 1;
      await prisma.pushSubscription.update({
        where: { id: subscription.id },
        data: { lastFailureAt: new Date(), failureCount: { increment: 1 } },
      });
    }
  }));

  if (transientFailures > 0) {
    throw new Error(`Web Push delivery failed for ${transientFailures} subscription(s)`);
  }
}
