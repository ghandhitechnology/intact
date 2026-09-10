import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeRiroBridgeHealth } from '../src/lib/server/riro-status';

test('summarizeRiroBridgeHealth reads a healthy bridge payload', () => {
  const status = summarizeRiroBridgeHealth(
    {
      status: 'ok',
      contractVersion: '2',
      verification: {
        lastSuccessAt: '2026-09-10T10:00:00Z',
        lastFailureAt: null,
        lastFailureCategory: null,
        lastFailureReason: null,
        failureStreak: 0,
        degraded: false,
      },
      diagnostics: { captureEnabled: true },
    },
    '2026-09-10T10:01:00Z',
  );
  assert.equal(status.state, 'ok');
  assert.equal(status.degraded, false);
  assert.equal(status.contractVersion, '2');
  assert.equal(status.captureEnabled, true);
  assert.equal(status.lastSuccessAt, '2026-09-10T10:00:00Z');
  assert.equal(status.failureStreak, 0);
});

test('summarizeRiroBridgeHealth flags degraded and unhealthy bridges', () => {
  const degraded = summarizeRiroBridgeHealth(
    {
      status: 'degraded',
      contractVersion: '2',
      verification: {
        degraded: true,
        failureStreak: 3,
        lastFailureCategory: 'profile_malformed',
        lastFailureReason: 'missing_role',
      },
    },
    '2026-09-10T10:01:00Z',
  );
  assert.equal(degraded.state, 'degraded');
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.failureStreak, 3);
  assert.equal(degraded.lastFailureReason, 'missing_role');

  assert.equal(summarizeRiroBridgeHealth({ status: 'unhealthy' }, 'x').state, 'degraded');
});
