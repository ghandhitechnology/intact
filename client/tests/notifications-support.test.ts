import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/lib/server/http';
import {
  decodeNotificationCursor,
  effectiveChannels,
  encodeNotificationCursor,
  isMandatoryNotification,
  isWithinQuietHours,
  notificationCursorWhere,
  notificationDeliveryDedupeKey,
  shouldDeliverPush,
} from '../src/lib/server/notifications';
import {
  assertSupportTicketAccess,
  canAccessSupportTicket,
  canTransitionSupportStatus,
  statusAfterRequesterReply,
  supportReplyDedupeKey,
} from '../src/lib/server/support';

test('sanction and security notifications override disabled channels and quiet hours', () => {
  assert.equal(isMandatoryNotification('SANCTION'), true);
  assert.equal(isMandatoryNotification('SYSTEM', { category: 'SECURITY' }), true);
  assert.deepEqual(effectiveChannels('SANCTION', { inAppEnabled: false, pushEnabled: false }), {
    inAppEnabled: true,
    pushEnabled: true,
  });
  assert.equal(shouldDeliverPush({
    type: 'SYSTEM',
    metadata: { mandatory: true },
    preference: { inAppEnabled: false, pushEnabled: false },
    quietHours: { enabled: true, start: '00:00', end: '23:59', timeZone: 'Asia/Seoul' },
    hasActiveSubscription: true,
    now: new Date('2026-07-17T12:00:00Z'),
  }), true);
});

test('push stays opt-in even for mandatory notifications', () => {
  assert.equal(shouldDeliverPush({
    type: 'SANCTION',
    hasActiveSubscription: false,
  }), false);
});

test('quiet hours handle a window crossing midnight', () => {
  const quietHours = { enabled: true, start: '22:00', end: '07:00', timeZone: 'Asia/Seoul' };
  assert.equal(isWithinQuietHours(quietHours, new Date('2026-07-17T14:30:00Z')), true);
  assert.equal(isWithinQuietHours(quietHours, new Date('2026-07-17T03:00:00Z')), false);
});

test('notification cursor round-trips both compound sort fields', () => {
  const cursor = {
    createdAt: new Date('2026-07-17T00:00:00.123Z'),
    id: '123e4567-e89b-12d3-a456-426614174000',
  };
  assert.deepEqual(decodeNotificationCursor(encodeNotificationCursor(cursor)), cursor);
  assert.deepEqual(notificationCursorWhere(cursor), {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  });
  assert.throws(() => decodeNotificationCursor('not-a-cursor'), (error) => {
    return error instanceof ApiError && error.status === 400 && error.code === 'INVALID_CURSOR';
  });
});

test('delivery and support reply dedupe keys are deterministic and scoped', () => {
  assert.equal(notificationDeliveryDedupeKey('notification-1'), notificationDeliveryDedupeKey('notification-1'));
  assert.notEqual(notificationDeliveryDedupeKey('notification-1'), notificationDeliveryDedupeKey('notification-2'));
  assert.equal(
    supportReplyDedupeKey('ticket-1', 'user-1', 'client-1'),
    supportReplyDedupeKey('ticket-1', 'user-1', 'client-1'),
  );
  assert.notEqual(
    supportReplyDedupeKey('ticket-1', 'user-1', 'client-1'),
    supportReplyDedupeKey('ticket-1', 'user-2', 'client-1'),
  );
});

test('support authorization only allows requester or admin and masks existence', () => {
  assert.equal(canAccessSupportTicket({ requesterId: 'requester', viewerId: 'requester' }), true);
  assert.equal(canAccessSupportTicket({ requesterId: 'requester', viewerId: 'other' }), false);
  assert.equal(canAccessSupportTicket({ requesterId: 'requester', viewerId: 'admin', isAdmin: true }), true);
  assert.throws(() => assertSupportTicketAccess({ requesterId: 'requester' }, 'other'), (error) => {
    return error instanceof ApiError && error.status === 404 && error.code === 'SUPPORT_TICKET_NOT_FOUND';
  });
});

test('support status transitions enforce lifecycle and requester reopen rules', () => {
  assert.equal(canTransitionSupportStatus('OPEN', 'IN_PROGRESS'), true);
  assert.equal(canTransitionSupportStatus('OPEN', 'RESOLVED'), false);
  assert.equal(canTransitionSupportStatus('RESOLVED', 'OPEN'), true);
  assert.equal(statusAfterRequesterReply('RESOLVED'), 'OPEN');
  assert.throws(() => statusAfterRequesterReply('CLOSED'), (error) => {
    return error instanceof ApiError && error.status === 409 && error.code === 'SUPPORT_TICKET_CLOSED';
  });
});
