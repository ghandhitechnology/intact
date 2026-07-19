import type { NotificationType, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from './http';

export const NOTIFICATION_TYPES: NotificationType[] = [
  'COMMENT',
  'REPLY',
  'MENTION',
  'RECOMMENDATION',
  'ANSWER_ACCEPTED',
  'MESSAGE',
  'NOTICE',
  'SANCTION',
  'SYSTEM',
];

export type NotificationChannels = {
  inAppEnabled: boolean;
  pushEnabled: boolean;
};

export type QuietHours = {
  enabled: boolean;
  start: string;
  end: string;
  timeZone: string;
};

export type NotificationCursor = {
  createdAt: Date;
  id: string;
};

export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: false,
  start: '22:00',
  end: '07:00',
  timeZone: 'Asia/Seoul',
};

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const CURSOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function objectMetadata(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isMandatoryNotification(type: NotificationType, metadata?: unknown) {
  if (type === 'SANCTION') return true;
  const value = objectMetadata(metadata);
  return type === 'SYSTEM' && (value?.mandatory === true || value?.category === 'SECURITY');
}

export function effectiveChannels(
  type: NotificationType,
  preference: Partial<NotificationChannels> | null | undefined,
  metadata?: unknown,
): NotificationChannels {
  if (isMandatoryNotification(type, metadata)) {
    return { inAppEnabled: true, pushEnabled: true };
  }
  return {
    inAppEnabled: preference?.inAppEnabled ?? true,
    pushEnabled: preference?.pushEnabled ?? false,
  };
}

export function parseQuietHours(value: unknown): QuietHours {
  const source = objectMetadata(value);
  const enabled = source?.enabled === true;
  const start = typeof source?.start === 'string' ? source.start : DEFAULT_QUIET_HOURS.start;
  const end = typeof source?.end === 'string' ? source.end : DEFAULT_QUIET_HOURS.end;
  const timeZone = typeof source?.timeZone === 'string' ? source.timeZone : DEFAULT_QUIET_HOURS.timeZone;
  if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) {
    throw new ApiError(400, 'INVALID_QUIET_HOURS', '방해 금지 시간 형식이 올바르지 않습니다.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new ApiError(400, 'INVALID_TIME_ZONE', '시간대가 올바르지 않습니다.');
  }
  return { enabled, start, end, timeZone };
}

function minuteInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

function timeToMinute(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function isWithinQuietHours(quietHours: QuietHours, now = new Date()) {
  if (!quietHours.enabled || quietHours.start === quietHours.end) return false;
  const current = minuteInTimeZone(now, quietHours.timeZone);
  const start = timeToMinute(quietHours.start);
  const end = timeToMinute(quietHours.end);
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function shouldDeliverPush(input: {
  type: NotificationType;
  preference?: Partial<NotificationChannels> | null;
  metadata?: unknown;
  quietHours?: QuietHours;
  hasActiveSubscription: boolean;
  now?: Date;
}) {
  if (!input.hasActiveSubscription) return false;
  const mandatory = isMandatoryNotification(input.type, input.metadata);
  if (!effectiveChannels(input.type, input.preference, input.metadata).pushEnabled) return false;
  return mandatory || !isWithinQuietHours(input.quietHours ?? DEFAULT_QUIET_HOURS, input.now);
}

export function encodeNotificationCursor(cursor: NotificationCursor) {
  return Buffer.from(JSON.stringify([cursor.createdAt.toISOString(), cursor.id]), 'utf8').toString('base64url');
}

export function decodeNotificationCursor(value: string | null): NotificationCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') {
      throw new Error('shape');
    }
    const createdAt = new Date(parsed[0]);
    if (!Number.isFinite(createdAt.getTime()) || !CURSOR_ID_PATTERN.test(parsed[1])) throw new Error('value');
    return { createdAt, id: parsed[1] };
  } catch {
    throw new ApiError(400, 'INVALID_CURSOR', '알림 커서가 올바르지 않습니다.');
  }
}

export function notificationCursorWhere(cursor: NotificationCursor) {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  } satisfies Prisma.NotificationWhereInput;
}

export function pushEndpointHash(endpoint: string) {
  return createHash('sha256').update(endpoint).digest('hex');
}

export function notificationDeliveryDedupeKey(notificationId: string) {
  return `notification-delivery:${notificationId}`;
}

type NotificationTransaction = Pick<
  Prisma.TransactionClient,
  'notification' | 'notificationPreference' | 'notificationSetting' | 'pushSubscription' | 'outboxEvent'
>;

export async function createNotificationWithDelivery(
  tx: NotificationTransaction,
  input: {
    id?: string;
    userId: string;
    actorId?: string | null;
    type: NotificationType;
    title: string;
    body?: string | null;
    href?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
) {
  const id = input.id ?? randomUUID();
  const [preference, setting, activeSubscription] = await Promise.all([
    tx.notificationPreference.findUnique({
      where: { userId_type: { userId: input.userId, type: input.type } },
      select: { inAppEnabled: true, pushEnabled: true },
    }),
    tx.notificationSetting.findUnique({
      where: { userId: input.userId },
      select: {
        quietHoursEnabled: true,
        quietHoursStart: true,
        quietHoursEnd: true,
        timeZone: true,
      },
    }),
    tx.pushSubscription.findFirst({
      where: {
        userId: input.userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    }),
  ]);
  const channels = effectiveChannels(input.type, preference, input.metadata);
  const quietHours = setting
    ? {
        enabled: setting.quietHoursEnabled,
        start: setting.quietHoursStart,
        end: setting.quietHoursEnd,
        timeZone: setting.timeZone,
      }
    : DEFAULT_QUIET_HOURS;
  const wantsPush = shouldDeliverPush({
    type: input.type,
    preference,
    metadata: input.metadata,
    quietHours,
    hasActiveSubscription: Boolean(activeSubscription),
  });
  if (!channels.inAppEnabled && !wantsPush) return null;

  const notification = channels.inAppEnabled
    ? await tx.notification.create({
        data: {
          id,
          userId: input.userId,
          actorId: input.actorId,
          type: input.type,
          title: input.title,
          body: input.body,
          href: input.href,
          metadata: input.metadata,
        },
      })
    : null;

  if (wantsPush) {
    await tx.outboxEvent.upsert({
      where: { dedupeKey: notificationDeliveryDedupeKey(id) },
      update: {},
      create: {
        eventType: 'notification.delivery.requested',
        aggregateType: 'Notification',
        aggregateId: id,
        dedupeKey: notificationDeliveryDedupeKey(id),
        payload: {
          notificationId: notification?.id ?? null,
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          href: input.href ?? null,
          mandatory: isMandatoryNotification(input.type, input.metadata),
        },
      },
    });
  }
  return notification;
}

export async function createNotificationsWithDelivery(
  tx: NotificationTransaction,
  inputs: Array<{
    id?: string;
    userId: string;
    actorId?: string | null;
    type: NotificationType;
    title: string;
    body?: string | null;
    href?: string | null;
    metadata?: Prisma.InputJsonValue;
  }>,
) {
  if (!inputs.length) return { notifications: 0, deliveries: 0 };
  const userIds = [...new Set(inputs.map(({ userId }) => userId))];
  const types = [...new Set(inputs.map(({ type }) => type))];
  const [preferences, settings, subscriptions] = await Promise.all([
    tx.notificationPreference.findMany({
      where: { userId: { in: userIds }, type: { in: types } },
      select: { userId: true, type: true, inAppEnabled: true, pushEnabled: true },
    }),
    tx.notificationSetting.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        quietHoursEnabled: true,
        quietHoursStart: true,
        quietHoursEnd: true,
        timeZone: true,
      },
    }),
    tx.pushSubscription.findMany({
      where: {
        userId: { in: userIds },
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      distinct: ['userId'],
      select: { userId: true },
    }),
  ]);
  const preferenceByUserType = new Map(
    preferences.map((preference) => [`${preference.userId}:${preference.type}`, preference]),
  );
  const settingByUser = new Map(settings.map((setting) => [setting.userId, setting]));
  const subscribedUsers = new Set(subscriptions.map(({ userId }) => userId));
  const prepared = inputs.map((input) => {
    const id = input.id ?? randomUUID();
    const preference = preferenceByUserType.get(`${input.userId}:${input.type}`);
    const channels = effectiveChannels(input.type, preference, input.metadata);
    const setting = settingByUser.get(input.userId);
    const quietHours = setting
      ? {
          enabled: setting.quietHoursEnabled,
          start: setting.quietHoursStart,
          end: setting.quietHoursEnd,
          timeZone: setting.timeZone,
        }
      : DEFAULT_QUIET_HOURS;
    const wantsPush = shouldDeliverPush({
      type: input.type,
      preference,
      metadata: input.metadata,
      quietHours,
      hasActiveSubscription: subscribedUsers.has(input.userId),
    });
    return { id, input, channels, wantsPush };
  });
  const notifications = prepared.filter(({ channels }) => channels.inAppEnabled);
  const deliveries = prepared.filter(({ wantsPush }) => wantsPush);
  if (notifications.length) {
    await tx.notification.createMany({
      data: notifications.map(({ id, input }) => ({
        id,
        userId: input.userId,
        actorId: input.actorId,
        type: input.type,
        title: input.title,
        body: input.body,
        href: input.href,
        metadata: input.metadata,
      })),
    });
  }
  if (deliveries.length) {
    await tx.outboxEvent.createMany({
      data: deliveries.map(({ id, input, channels }) => ({
        eventType: 'notification.delivery.requested',
        aggregateType: 'Notification',
        aggregateId: id,
        dedupeKey: notificationDeliveryDedupeKey(id),
        payload: {
          notificationId: channels.inAppEnabled ? id : null,
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          href: input.href ?? null,
          mandatory: isMandatoryNotification(input.type, input.metadata),
        },
      })),
      skipDuplicates: true,
    });
  }
  return { notifications: notifications.length, deliveries: deliveries.length };
}
