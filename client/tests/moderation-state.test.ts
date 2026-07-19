import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAdminModerationAction,
  canModerationTransition,
  isTerminalModerationState,
  transitionModerationSnapshot,
  type ModerationTransitionSnapshot,
} from '../src/lib/server/moderation-state';

const processing = (overrides: Partial<ModerationTransitionSnapshot> = {}): ModerationTransitionSnapshot => ({
  state: 'PROCESSING',
  transitionVersion: 4,
  leaseToken: '00000000-0000-4000-8000-000000000004',
  latest: true,
  ...overrides,
});

test('terminal moderation states cannot transition or be resurrected', () => {
  for (const state of ['ALLOWED', 'BLOCKED', 'SUPERSEDED'] as const) {
    assert.equal(isTerminalModerationState(state), true);
    assert.equal(canModerationTransition(state, 'QUEUED', 'ADMIN_RETRY'), false);
    assert.equal(canModerationTransition(state, 'ALLOWED', 'WORKER_RESULT'), false);
  }
});

test('a superseding transition wins over a stale worker completion', () => {
  const claimed = processing();
  const superseded = transitionModerationSnapshot(
    claimed,
    claimed,
    'SUPERSEDED',
    'SYSTEM_SUPERSEDE',
  );
  assert.ok(superseded);
  assert.equal(superseded.state, 'SUPERSEDED');
  assert.equal(superseded.transitionVersion, 5);
  assert.equal(superseded.leaseToken, null);

  const staleCompletion = transitionModerationSnapshot(
    superseded,
    claimed,
    'ALLOWED',
    'WORKER_RESULT',
  );
  assert.equal(staleCompletion, null);
});

test('only the current lease token and transition version can complete reclaimed work', () => {
  const firstLease = processing();
  const reclaimed = transitionModerationSnapshot(
    firstLease,
    firstLease,
    'PROCESSING',
    'WORKER_CLAIM',
    '00000000-0000-4000-8000-000000000005',
  );
  assert.ok(reclaimed);

  assert.equal(transitionModerationSnapshot(
    reclaimed,
    firstLease,
    'NEEDS_REVIEW',
    'WORKER_RESULT',
  ), null);

  const currentCompletion = transitionModerationSnapshot(
    reclaimed,
    reclaimed,
    'NEEDS_REVIEW',
    'WORKER_RESULT',
  );
  assert.ok(currentCompletion);
  assert.equal(currentCompletion.state, 'NEEDS_REVIEW');
  assert.equal(currentCompletion.transitionVersion, 6);
});

test('a non-latest submission fails CAS even when its lease matches', () => {
  const stale = processing({ latest: false });
  assert.equal(transitionModerationSnapshot(stale, stale, 'BLOCKED', 'WORKER_RESULT'), null);
});

test('admin review and retry eligibility is limited to reviewable states', () => {
  for (const state of ['NEEDS_REVIEW', 'FAILED'] as const) {
    assert.equal(canAdminModerationAction(state, 'APPROVE'), true);
    assert.equal(canAdminModerationAction(state, 'REJECT'), true);
    assert.equal(canAdminModerationAction(state, 'RETRY'), true);
  }
  for (const state of ['QUEUED', 'PROCESSING', 'ALLOWED', 'BLOCKED', 'SUPERSEDED'] as const) {
    assert.equal(canAdminModerationAction(state, 'APPROVE'), false);
    assert.equal(canAdminModerationAction(state, 'REJECT'), false);
    assert.equal(canAdminModerationAction(state, 'RETRY'), false);
  }
});

test('an audited retry advances the version and cannot be repeated from stale state', () => {
  const review: ModerationTransitionSnapshot = {
    state: 'NEEDS_REVIEW',
    transitionVersion: 8,
    leaseToken: null,
    latest: true,
  };
  const retry = transitionModerationSnapshot(review, review, 'QUEUED', 'ADMIN_RETRY');
  assert.ok(retry);
  assert.equal(retry.transitionVersion, 9);
  assert.equal(transitionModerationSnapshot(retry, review, 'QUEUED', 'ADMIN_RETRY'), null);
});
