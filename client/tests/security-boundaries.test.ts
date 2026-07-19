import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, assertSameOrigin, getClientIp } from '../src/lib/server/http';
import { decryptText, encryptText, randomToken } from '../src/lib/server/crypto';
import { isTrustedPushEndpoint } from '../src/lib/server/push-endpoint';

function withEnvironment(values: Record<string, string | undefined>, run: () => void) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('trusted proxy identity cannot be replaced through X-Forwarded-For', () => {
  withEnvironment({ TRUST_PROXY: 'true' }, () => {
    const request = new Request('https://ishsoutside.com/api/auth/login', {
      headers: {
        'x-forwarded-for': '1.2.3.4, 203.0.113.8',
        'x-real-ip': '203.0.113.8',
      },
    });
    assert.equal(getClientIp(request), '203.0.113.8');
    assert.equal(getClientIp(new Request(request.url, {
      headers: { 'x-real-ip': 'not-an-ip' },
    })), 'trusted-proxy-unknown');
  });
});

test('cookie mutations require a verifiable same origin', () => {
  withEnvironment({
    NEXT_PUBLIC_APP_URL: 'https://ishsoutside.com',
    INTERNAL_API_SECRET: 'test-internal-secret-at-least-32-characters',
  }, () => {
    assert.throws(
      () => assertSameOrigin(new Request('https://ishsoutside.com/api/profile', {
        method: 'POST',
        headers: { cookie: 'igwak_session=stolen' },
      })),
      (error: unknown) => error instanceof ApiError && error.code === 'MISSING_ORIGIN',
    );
    assert.doesNotThrow(() => assertSameOrigin(new Request('https://ishsoutside.com/api/profile', {
      method: 'POST',
      headers: { origin: 'https://ishsoutside.com', cookie: 'igwak_session=valid' },
    })));
    const realtimeRequest = new Request('http://web:3000/api/messages', {
      method: 'PATCH',
      headers: {
        cookie: 'igwak_session=valid',
        'x-igwak-realtime-origin': 'test-internal-secret-at-least-32-characters',
      },
    });
    assert.throws(
      () => assertSameOrigin(realtimeRequest),
      (error: unknown) => error instanceof ApiError && error.code === 'MISSING_ORIGIN',
    );
    assert.doesNotThrow(() => assertSameOrigin(realtimeRequest, { allowRealtimeGateway: true }));
    assert.doesNotThrow(() => assertSameOrigin(new Request('https://ishsoutside.com/api/profile', {
      method: 'POST',
      headers: { authorization: 'Bearer explicit-api-token' },
    })));
  });
});

test('Web Push destinations reject SSRF targets and suffix confusion', () => {
  withEnvironment({ PUSH_ENDPOINT_HOSTS: 'push.school.example' }, () => {
    assert.equal(isTrustedPushEndpoint('https://fcm.googleapis.com/fcm/send/opaque'), true);
    assert.equal(isTrustedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/opaque'), true);
    assert.equal(isTrustedPushEndpoint('https://wns2-am3p.notify.windows.com/w/?token=opaque'), true);
    assert.equal(isTrustedPushEndpoint('https://push.school.example/subscription'), true);
    assert.equal(isTrustedPushEndpoint('https://127.0.0.1/internal'), false);
    assert.equal(isTrustedPushEndpoint('https://[::1]/internal'), false);
    assert.equal(isTrustedPushEndpoint('https://metadata.google.internal/latest'), false);
    assert.equal(isTrustedPushEndpoint('https://notify.windows.com.attacker.example/push'), false);
    assert.equal(isTrustedPushEndpoint('https://push.school.example:8443/subscription'), false);
    assert.equal(isTrustedPushEndpoint('https://user:pass@fcm.googleapis.com/fcm/send/opaque'), false);
  });
});

test('session tokens retain a fixed unambiguous wire format', () => {
  assert.match(randomToken(), /^[A-Za-z0-9_-]{43}$/);
});

test('encrypted fields require a canonical 128-bit AES-GCM authentication tag', () => {
  withEnvironment({
    PORTAL_ENCRYPTION_KEY: 'test-security-encryption-key-at-least-32-characters',
  }, () => {
    const encrypted = encryptText('private value');
    assert.equal(decryptText(encrypted), 'private value');
    const parts = encrypted.split('.');
    parts[2] = parts[2]!.slice(0, -2);
    assert.throws(() => decryptText(parts.join('.')), /Malformed encrypted value/);
    assert.throws(() => decryptText(`${encrypted}.extra`), /Malformed encrypted value/);
  });
});
