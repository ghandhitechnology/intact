import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPublicReverificationState,
  getReverificationState,
  REVERIFICATION_GRACE_MS,
  REVERIFICATION_WARNING_MS,
} from '../src/lib/server/reverification';

const dueAt = new Date('2026-09-15T00:00:00.000Z');

test('reverification without a due date is current', () => {
  assert.deepEqual(
    getReverificationState(null, new Date('2026-09-01T00:00:00.000Z')),
    { kind: 'current' },
  );
});

test('reverification warning begins exactly fourteen days before the due date', () => {
  const warningStartsAt = dueAt.getTime() - REVERIFICATION_WARNING_MS;
  assert.equal(
    getReverificationState(dueAt, new Date(warningStartsAt - 1)).kind,
    'current',
  );
  assert.deepEqual(
    getReverificationState(dueAt, new Date(warningStartsAt)),
    {
      kind: 'warning',
      dueAt: dueAt.toISOString(),
      requiredAt: new Date(dueAt.getTime() + REVERIFICATION_GRACE_MS).toISOString(),
    },
  );
});

test('reverification grace begins at the due date and lasts seven full days', () => {
  const requiredAt = new Date(dueAt.getTime() + REVERIFICATION_GRACE_MS);
  assert.deepEqual(
    getReverificationState(dueAt, dueAt),
    {
      kind: 'grace',
      dueAt: dueAt.toISOString(),
      requiredAt: requiredAt.toISOString(),
    },
  );
  assert.equal(
    getReverificationState(dueAt, new Date(requiredAt.getTime() - 1)).kind,
    'grace',
  );
  assert.deepEqual(
    getReverificationState(dueAt, requiredAt),
    {
      kind: 'required',
      dueAt: dueAt.toISOString(),
      requiredAt: requiredAt.toISOString(),
    },
  );
});

test('public reverification state never exposes the internal required variant', () => {
  const requiredAt = new Date(dueAt.getTime() + REVERIFICATION_GRACE_MS);
  assert.deepEqual(getPublicReverificationState(dueAt, requiredAt), { kind: 'current' });
});
