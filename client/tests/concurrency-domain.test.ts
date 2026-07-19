import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bookmarkLockKeys,
  recommendationLockKeys,
  reportLockKey,
} from '../src/lib/server/domain/concurrency';
import {
  matchesSentTransferReplay,
  transferLedgerKeys,
} from '../src/lib/server/domain/igk-transfer';

test('report locks isolate reporters and exact targets', () => {
  const key = reportLockKey('reporter-a', 'MESSAGE', 'message-a');
  assert.equal(key, reportLockKey('reporter-a', 'MESSAGE', 'message-a'));
  assert.notEqual(key, reportLockKey('reporter-b', 'MESSAGE', 'message-a'));
  assert.notEqual(key, reportLockKey('reporter-a', 'MESSAGE', 'message-b'));
});

test('recommendation and bookmark operations share stable mutation locks', () => {
  assert.deepEqual(
    recommendationLockKeys(
      'user-a',
      { postId: null, commentId: 'comment-a' },
      'post-a',
    ),
    [
      'comment:comment-a',
      'recommendation:user-a:comment:comment-a',
      'post:post-a',
    ],
  );
  assert.deepEqual(bookmarkLockKeys('user-a', 'post-a'), [
    'post:post-a',
    'bookmark:user-a:post:post-a',
  ]);
});

test('received transfer keys include both parties and fit the ledger column', () => {
  const first = transferLedgerKeys('sender-a', 'recipient-a', 'same-request');
  const replay = transferLedgerKeys('sender-a', 'recipient-a', 'same-request');
  const otherSender = transferLedgerKeys('sender-b', 'recipient-a', 'same-request');

  assert.deepEqual(first, replay);
  assert.notEqual(first.received, otherSender.received);

  const uuid = '12345678-1234-1234-1234-123456789012';
  const maximum = transferLedgerKeys(uuid, uuid, 'x'.repeat(100));
  assert.ok(maximum.sent.length <= 160);
  assert.ok(maximum.received.length <= 160);
});

test('transfer replay matching rejects semantic idempotency collisions', () => {
  const ledger = {
    userId: 'sender-a',
    counterpartyId: 'recipient-a',
    type: 'TRANSFER_SENT',
    amount: -25,
  };
  assert.equal(
    matchesSentTransferReplay(ledger, {
      senderId: 'sender-a',
      recipientId: 'recipient-a',
      amount: 25,
    }),
    true,
  );
  assert.equal(
    matchesSentTransferReplay(ledger, {
      senderId: 'sender-a',
      recipientId: 'recipient-b',
      amount: 25,
    }),
    false,
  );
  assert.equal(
    matchesSentTransferReplay(ledger, {
      senderId: 'sender-a',
      recipientId: 'recipient-a',
      amount: 26,
    }),
    false,
  );
});
