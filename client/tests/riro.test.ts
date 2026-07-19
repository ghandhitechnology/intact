import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import { ApiError } from '../src/lib/server/http';
import { signRiroBridgeRequest, verifyRiroAccount } from '../src/lib/server/riro';

const BRIDGE_SECRET = 's'.repeat(64);

async function withMockBridge(
  mockFetch: typeof fetch,
  callback: () => Promise<void>,
) {
  const previousFetch = globalThis.fetch;
  const previousMode = process.env.RIRO_AUTH_MODE;
  const previousUrl = process.env.RIRO_BRIDGE_URL;
  const previousSecret = process.env.RIRO_BRIDGE_SECRET;
  globalThis.fetch = mockFetch;
  process.env.RIRO_AUTH_MODE = 'BRIDGE';
  process.env.RIRO_BRIDGE_URL = 'https://bridge.example.test';
  process.env.RIRO_BRIDGE_SECRET = BRIDGE_SECRET;
  try {
    await callback();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousMode === undefined) delete process.env.RIRO_AUTH_MODE;
    else process.env.RIRO_AUTH_MODE = previousMode;
    if (previousUrl === undefined) delete process.env.RIRO_BRIDGE_URL;
    else process.env.RIRO_BRIDGE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.RIRO_BRIDGE_SECRET;
    else process.env.RIRO_BRIDGE_SECRET = previousSecret;
  }
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('signs the exact serialized Riroschool bridge request', () => {
  const body = JSON.stringify({ id: 'student', password: 'not-logged' });
  const secret = 'a'.repeat(64);
  const timestamp = '1784190000';
  const nonce = 'nonce_value_1234567890';
  const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${bodyHash}`, 'utf8')
    .digest('hex');
  assert.equal(signRiroBridgeRequest(body, secret, timestamp, nonce), expected);
});

test('signatures change when a credential request is modified', () => {
  const secret = 'b'.repeat(64);
  const timestamp = '1784190000';
  const nonce = 'nonce_value_1234567890';
  const first = signRiroBridgeRequest('{"id":"one","password":"pw"}', secret, timestamp, nonce);
  const second = signRiroBridgeRequest('{"id":"two","password":"pw"}', secret, timestamp, nonce);
  assert.notEqual(first, second);
});

test('sends one signed request and normalizes the bridge profile', async () => {
  let calls = 0;
  const mockFetch: typeof fetch = async (input, init) => {
    calls += 1;
    assert.equal(String(input), 'https://bridge.example.test/v1/verify');
    assert.equal(init?.method, 'POST');
    const body = String(init?.body);
    assert.equal(body, JSON.stringify({ id: '26-10218', password: 'private-password' }));
    const headers = new Headers(init?.headers);
    const timestamp = headers.get('x-riro-timestamp') ?? '';
    const nonce = headers.get('x-riro-nonce') ?? '';
    assert.match(nonce, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(
      headers.get('x-riro-signature'),
      signRiroBridgeRequest(body, BRIDGE_SECRET, timestamp, nonce),
    );
    return jsonResponse({
      ok: true,
      profile: {
        name: '홍길동',
        currentStudentNumber: '1218',
        generation: 33,
        role: '학생',
      },
    });
  };

  await withMockBridge(mockFetch, async () => {
    const profile = await verifyRiroAccount('26-10218', 'private-password');
    assert.equal(profile.name, '홍길동');
    assert.equal(profile.studentCode, '331218');
    assert.equal(profile.grade, 1);
    assert.equal(profile.classNumber, 2);
    assert.equal(profile.studentNumber, 18);
  });
  assert.equal(calls, 1);
});

test('does not retry invalid credentials and preserves the public 401 contract', async () => {
  let calls = 0;
  const mockFetch: typeof fetch = async () => {
    calls += 1;
    return jsonResponse({
      ok: false,
      error: { code: 'RIRO_INVALID_CREDENTIALS', message: 'upstream message' },
    }, 401);
  };

  await withMockBridge(mockFetch, async () => {
    await assert.rejects(
      verifyRiroAccount('student', 'wrong-password'),
      (error: unknown) => error instanceof ApiError
        && error.status === 401
        && error.code === 'RIRO_INVALID_CREDENTIALS',
    );
  });
  assert.equal(calls, 1);
});

test('does not amplify bridge retries and redacts malformed upstream errors', async () => {
  let calls = 0;
  const logged: unknown[][] = [];
  const previousConsoleError = console.error;
  console.error = (...values: unknown[]) => logged.push(values);
  const mockFetch: typeof fetch = async () => {
    calls += 1;
    return new Response('private-password 홍길동 1218', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    });
  };

  try {
    await withMockBridge(mockFetch, async () => {
      await assert.rejects(
        verifyRiroAccount('student', 'private-password'),
        (error: unknown) => error instanceof ApiError
          && error.status === 503
          && error.code === 'RIRO_UNAVAILABLE',
      );
    });
  } finally {
    console.error = previousConsoleError;
  }

  assert.equal(calls, 1);
  const logText = JSON.stringify(logged);
  assert.equal(logText.includes('private-password'), false);
  assert.equal(logText.includes('홍길동'), false);
  assert.equal(logText.includes('1218'), false);
});
