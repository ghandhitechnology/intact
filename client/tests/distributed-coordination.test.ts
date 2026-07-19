import assert from 'node:assert/strict';
import test from 'node:test';
import { outboxRetryDelayMs, toOutboxJson } from '../src/lib/server/outbox';
import { consumeRedisTokenBucket } from '../src/lib/server/rate-limit-redis';

test('token bucket parses an atomic Redis decision', async () => {
  const calls: unknown[] = [];
  const result = await consumeRedisTokenBucket({
    key: 'login:hashed-client',
    capacity: 5,
    refillPerSecond: 1,
    failPolicy: 'closed',
    nowMs: 10_000,
  }, {
    async eval(_script, options) {
      calls.push(options);
      return [1, 4, 0];
    },
  });
  assert.deepEqual(result, {
    allowed: true,
    remaining: 4,
    retryAfterMs: 0,
    source: 'redis',
  });
  assert.equal(calls.length, 1);
});

test('token bucket requires callers to choose Redis failure behavior', async () => {
  const open = await consumeRedisTokenBucket({
    key: 'read:client', capacity: 10, refillPerSecond: 2, failPolicy: 'open',
  }, null);
  const closed = await consumeRedisTokenBucket({
    key: 'auth:client', capacity: 3, refillPerSecond: 1, failPolicy: 'closed',
  }, null);
  assert.equal(open.allowed, true);
  assert.equal(open.source, 'fail-open');
  assert.equal(closed.allowed, false);
  assert.equal(closed.source, 'fail-closed');
});

test('outbox retry backoff is bounded and exponential', () => {
  assert.equal(outboxRetryDelayMs(1), 1_000);
  assert.equal(outboxRetryDelayMs(2), 2_000);
  assert.equal(outboxRetryDelayMs(5), 16_000);
  assert.equal(outboxRetryDelayMs(99), 15 * 60_000);
});

test('outbox payload conversion recursively normalizes dates and bigints', () => {
  assert.deepEqual(toOutboxJson({
    createdAt: new Date('2026-07-17T00:00:00.123Z'),
    sequence: BigInt(42),
    nested: [{ sizeBytes: BigInt(1024), optional: undefined }],
  }), {
    createdAt: '2026-07-17T00:00:00.123Z',
    sequence: '42',
    nested: [{ sizeBytes: '1024' }],
  });
  assert.throws(() => toOutboxJson({ invalid: Number.NaN }), /Non-finite number/);
});
