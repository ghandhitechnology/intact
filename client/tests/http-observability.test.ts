import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { ApiError, json, jsonError } from '../src/lib/server/http';
import { requestId } from '../src/lib/request-id';
import { logStructuredError } from '../src/lib/server/observability';
import { middleware } from '../src/middleware';

const VALID_REQUEST_ID = 'portal_request_1234567890';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('requestId accepts bounded safe IDs and replaces unsafe input', () => {
  assert.equal(requestId(`  ${VALID_REQUEST_ID}  `), VALID_REQUEST_ID);
  assert.match(requestId('short'), UUID_PATTERN);
  assert.match(requestId('invalid header value\r\nX-Injected: yes'), UUID_PATTERN);
  assert.match(requestId('x'.repeat(81)), UUID_PATTERN);
});

test('JSON responses set defaults and preserve a valid correlation ID', async () => {
  const response = json(
    { count: 1 },
    201,
    { 'Cache-Control': 'private', 'X-Request-ID': VALID_REQUEST_ID },
  );

  assert.equal(response.status, 201);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'private');
  assert.equal(response.headers.get('x-request-id'), VALID_REQUEST_ID);
  assert.deepEqual(await response.json(), { ok: true, data: { count: 1 } });
});

test('JSON responses replace an invalid correlation header', () => {
  const response = json({}, 200, { 'X-Request-ID': 'invalid' });
  assert.match(response.headers.get('x-request-id') ?? '', UUID_PATTERN);
});

test('rate-limit errors expose retry and request correlation headers', async () => {
  const response = jsonError(
    new ApiError(429, 'RATE_LIMITED', 'slow down', { retryAfter: 1.2 }),
    VALID_REQUEST_ID,
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '2');
  assert.equal(response.headers.get('x-request-id'), VALID_REQUEST_ID);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'slow down',
      details: { retryAfter: 1.2 },
    },
  });
});

test('structured errors omit exception messages and non-frame stack details', () => {
  const sensitive = 'credential-value-must-not-appear';
  const error = new Error(sensitive);
  error.stack = `Error: ${sensitive}\ncontinued ${sensitive}\n    at safeFrame (/srv/app.js:1:1)`;
  const originalConsoleError = console.error;
  let output = '';
  console.error = (value?: unknown) => {
    output = String(value);
  };

  try {
    logStructuredError('test.redaction', error, { requestId: VALID_REQUEST_ID });
  } finally {
    console.error = originalConsoleError;
  }

  assert.doesNotMatch(output, new RegExp(sensitive));
  assert.deepEqual(JSON.parse(output), {
    timestamp: JSON.parse(output).timestamp,
    level: 'error',
    event: 'test.redaction',
    requestId: VALID_REQUEST_ID,
    errorType: 'Error',
    stack: ['at safeFrame (/srv/app.js:1:1)'],
  });
});

test('middleware returns and forwards the same request ID', async () => {
  const previousDemoMode = process.env.PORTAL_DEMO_MODE;
  process.env.PORTAL_DEMO_MODE = 'true';
  try {
    const response = await middleware(new NextRequest('http://localhost/api/example', {
      headers: { 'X-Request-ID': VALID_REQUEST_ID },
    }));

    assert.equal(response.headers.get('x-request-id'), VALID_REQUEST_ID);
    assert.equal(response.headers.get('x-middleware-request-x-request-id'), VALID_REQUEST_ID);
    assert.match(response.headers.get('x-middleware-override-headers') ?? '', /(?:^|,)x-request-id(?:,|$)/);
  } finally {
    if (previousDemoMode === undefined) delete process.env.PORTAL_DEMO_MODE;
    else process.env.PORTAL_DEMO_MODE = previousDemoMode;
  }
});
