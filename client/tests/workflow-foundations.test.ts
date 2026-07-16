import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/lib/server/http';
import { encryptText } from '../src/lib/server/crypto';
import {
  createNotificationWithDelivery,
  decodeNotificationCursor,
  parseQuietHours,
} from '../src/lib/server/notifications';
import { deliverNotificationPush } from '../src/lib/server/push';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

test('quiet-hour parsing rejects invalid clocks and time zones', () => {
  assert.throws(() => parseQuietHours({ enabled: true, start: '24:00' }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    return error.code === 'INVALID_QUIET_HOURS';
  });
  assert.throws(() => parseQuietHours({ enabled: true, timeZone: 'Mars/Olympus_Mons' }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    return error.code === 'INVALID_TIME_ZONE';
  });
});

test('notification cursors reject malformed UUID tiebreakers', () => {
  const malformed = Buffer.from(JSON.stringify([
    '2026-07-17T01:02:03.456Z',
    '------------------------------------',
  ])).toString('base64url');
  assert.throws(() => decodeNotificationCursor(malformed), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    return error.code === 'INVALID_CURSOR';
  });
});

function notificationTx(
  preference: { inAppEnabled: boolean; pushEnabled: boolean } | null,
  active: boolean,
  setting: {
    quietHoursEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
    timeZone: string;
  } | null = null,
) {
  const calls = { notifications: 0, outbox: 0 };
  const tx = {
    notificationPreference: { findUnique: async () => preference },
    notificationSetting: { findUnique: async () => setting },
    pushSubscription: { findFirst: async () => active ? { id: UUID_C } : null },
    notification: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        calls.notifications += 1;
        return data;
      },
    },
    outboxEvent: {
      upsert: async () => {
        calls.outbox += 1;
        return {};
      },
    },
  };
  return { tx: tx as unknown as Parameters<typeof createNotificationWithDelivery>[0], calls };
}

test('notification creation persists nothing when every selected channel is disabled', async () => {
  const { tx, calls } = notificationTx({ inAppEnabled: false, pushEnabled: false }, true);
  const result = await createNotificationWithDelivery(tx, {
    id: UUID_A,
    userId: UUID_B,
    type: 'MESSAGE',
    title: 'disabled',
  });

  assert.equal(result, null);
  assert.deepEqual(calls, { notifications: 0, outbox: 0 });
});

test('encrypted Web Push subscriptions are decrypted only at delivery', async () => {
  const previousKey = process.env.PORTAL_ENCRYPTION_KEY;
  process.env.PORTAL_ENCRYPTION_KEY = 'test-encryption-key-with-at-least-32-characters';
  const updates: unknown[] = [];
  let delivered: unknown;
  const prisma = {
    pushSubscription: {
      findMany: async () => [{
        id: UUID_C,
        endpoint: encryptText('https://push.example.test/subscription'),
        p256dh: encryptText('public-key'),
        auth: encryptText('auth-key'),
      }],
      update: async (value: unknown) => { updates.push(value); return value; },
    },
  };
  try {
    await deliverNotificationPush(
      prisma as unknown as Parameters<typeof deliverNotificationPush>[0],
      { userId: UUID_B, type: 'MESSAGE', href: '/messages' },
      {
        sendNotification: async (subscription, body) => {
          delivered = { subscription, body };
          return { statusCode: 201, body: '', headers: {} };
        },
      },
    );
  } finally {
    if (previousKey === undefined) delete process.env.PORTAL_ENCRYPTION_KEY;
    else process.env.PORTAL_ENCRYPTION_KEY = previousKey;
  }
  assert.deepEqual((delivered as { subscription: unknown }).subscription, {
    endpoint: 'https://push.example.test/subscription',
    keys: { p256dh: 'public-key', auth: 'auth-key' },
  });
  assert.equal(updates.length, 1);
});

test('push-enabled creation writes one notification and one deduplicated delivery request', async () => {
  const { tx, calls } = notificationTx({ inAppEnabled: true, pushEnabled: true }, true);
  const result = await createNotificationWithDelivery(tx, {
    id: UUID_A,
    userId: UUID_B,
    type: 'MESSAGE',
    title: 'new message',
  });

  assert.equal((result as { id?: string })?.id, UUID_A);
  assert.deepEqual(calls, { notifications: 1, outbox: 1 });
});

test('persisted quiet hours suppress optional push without suppressing in-app delivery', async () => {
  const { tx, calls } = notificationTx(
    { inAppEnabled: true, pushEnabled: true },
    true,
    {
      quietHoursEnabled: true,
      quietHoursStart: '00:00',
      quietHoursEnd: '23:59',
      timeZone: 'Asia/Seoul',
    },
  );
  await createNotificationWithDelivery(tx, {
    id: UUID_A,
    userId: UUID_B,
    type: 'MESSAGE',
    title: 'quiet message',
  });
  assert.deepEqual(calls, { notifications: 1, outbox: 0 });
});
