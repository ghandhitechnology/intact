import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../src/lib/client/api-client';
import { parseHomeApiResult, parseHomeData } from '../src/lib/contracts/home';
import { ContractParseError, expectRecord, expectString } from '../src/lib/contracts/runtime';

const validHome = {
  boards: [{ id: 'board-1', slug: 'free', name: '자유게시판' }],
  notices: [{ id: 'notice-1', title: '공지' }],
  leaders: [{ id: 'user-1', nickname: '학생' }],
  account: { currentIgk: 120, igkRank: null, unreadCount: 2 },
  generatedAt: '2026-07-17T00:00:00.000Z',
  sectionErrors: {},
};

function parseMessage(value: unknown) {
  return expectString(expectRecord(value, 'data').message, 'data.message');
}

test('parses ApiResult envelopes and rejects invalid account values', () => {
  assert.deepEqual(parseHomeApiResult({ ok: true, data: validHome }), { ok: true, data: validHome });
  assert.deepEqual(
    parseHomeApiResult({ ok: false, error: { code: 'UNAVAILABLE', message: '잠시 후 다시 시도해 주세요.' } }),
    { ok: false, error: { code: 'UNAVAILABLE', message: '잠시 후 다시 시도해 주세요.' } },
  );
  assert.throws(
    () => parseHomeData({ ...validHome, account: { ...validHome.account, currentIgk: '120' } }),
    ContractParseError,
  );
});

test('deduplicates concurrent GET requests with the same contract', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = async () => {
    calls += 1;
    await gate;
    return new Response(JSON.stringify({ ok: true, data: { message: 'ok' } }), {
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = new ApiClient();
    const first = client.get('/api/example', parseMessage);
    const second = client.get('/api/example', parseMessage);
    release?.();
    assert.deepEqual(await Promise.all([first, second]), ['ok', 'ok']);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries idempotent reads but never retries writes', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('temporary network failure');
    return new Response(JSON.stringify({ ok: true, data: { message: 'recovered' } }));
  };

  try {
    const client = new ApiClient();
    assert.equal(await client.get('/api/read', parseMessage, { retryDelayMs: 0 }), 'recovered');
    assert.equal(calls, 2);

    calls = 0;
    await assert.rejects(
      client.request('/api/write', parseMessage, { method: 'POST', retryDelayMs: 0 }),
      { code: 'NETWORK_ERROR' },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('notifies resource invalidation subscribers', () => {
  const client = new ApiClient();
  const invalidated: string[] = [];
  const unsubscribe = client.onInvalidated('/api/home', (resource) => invalidated.push(resource));
  client.invalidate('/api/home?refresh=1');
  unsubscribe();
  client.invalidate('/api/home');
  assert.deepEqual(invalidated, ['/api/home?refresh=1']);
});
