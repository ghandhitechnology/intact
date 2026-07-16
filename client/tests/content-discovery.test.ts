import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/lib/server/http';
import {
  decodeCursor,
  encodeCursor,
  isAfterCompoundCursor,
} from '../src/lib/server/cursor';
import {
  assertPostVersion,
  postConflictDetails,
  requestedPostVersion,
} from '../src/lib/server/post-version';
import { buildRankedPostSearch } from '../src/lib/server/search';

const CURSOR_SECRET = 'test-only-cursor-secret-with-32-bytes';

test('cursor round-trips compound values and is scope-bound', () => {
  const position = [true, '2026-07-17T03:04:05.000Z', 'post-id'] as const;
  const cursor = encodeCursor('posts:latest', [...position], CURSOR_SECRET);
  assert.deepEqual(decodeCursor(cursor, 'posts:latest', CURSOR_SECRET), position);
  assert.throws(
    () => decodeCursor(cursor, 'posts:popular', CURSOR_SECRET),
    (error: unknown) => error instanceof ApiError && error.code === 'INVALID_CURSOR',
  );
});

test('cursor rejects payload and signature tampering', () => {
  const cursor = encodeCursor('comments:post-1', ['2026-07-17T03:04:05.000Z', 'comment-1'], CURSOR_SECRET);
  const [payload, signature] = cursor.split('.');
  assert.ok(payload && signature);
  const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith('A') ? 'B' : 'A'}.${signature}`;
  const tamperedSignature = `${payload}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
  for (const value of [tamperedPayload, tamperedSignature]) {
    assert.throws(
      () => decodeCursor(value, 'comments:post-1', CURSOR_SECRET),
      (error: unknown) => error instanceof ApiError && error.code === 'INVALID_CURSOR',
    );
  }
});

test('descending compound cursor is stable across a concurrent insert', () => {
  const firstPage = [[5, 'e'], [4, 'd']] as Array<[number, string]>;
  const cursor = firstPage.at(-1)!;
  const afterInsert = [[6, 'f'], [5, 'e'], [4, 'd'], [3, 'c'], [2, 'b']]
    .filter((position) => isAfterCompoundCursor(position, cursor, ['desc', 'desc']));
  assert.deepEqual(afterInsert, [[3, 'c'], [2, 'b']]);
});

test('ascending compound cursor breaks equal timestamps by id', () => {
  const cursor = ['2026-07-17T03:04:05.000Z', 'b'];
  assert.equal(isAfterCompoundCursor(['2026-07-17T03:04:05.000Z', 'c'], cursor, ['asc', 'asc']), true);
  assert.equal(isAfterCompoundCursor(['2026-07-17T03:04:05.000Z', 'a'], cursor, ['asc', 'asc']), false);
});

test('post versions accept body or If-Match and reject disagreement', () => {
  assert.equal(requestedPostVersion(new Request('https://portal.test'), 3), 3);
  assert.equal(requestedPostVersion(new Request('https://portal.test', {
    headers: { 'If-Match': 'W/"post-123e4567-e89b-12d3-a456-426614174000-v4"' },
  }), undefined), 4);
  assert.throws(
    () => requestedPostVersion(new Request('https://portal.test', {
      headers: { 'If-Match': '"4"' },
    }), 3),
    (error: unknown) => error instanceof ApiError && error.code === 'POST_VERSION_MISMATCH',
  );
});

test('version conflict returns a recoverable current snapshot', () => {
  const current = {
    id: 'post-1',
    version: 7,
    updatedAt: new Date('2026-07-17T03:04:05.000Z'),
    status: 'PUBLISHED',
    title: 'server title',
    content: 'server content',
    tags: ['server'],
    metadata: { deadline: '2026-08-01' },
    boardId: 'board-1',
  };
  assert.deepEqual(postConflictDetails(current, 6), {
    recoverable: true,
    baseVersion: 6,
    currentVersion: 7,
    current: {
      ...current,
      updatedAt: '2026-07-17T03:04:05.000Z',
    },
  });
  assert.throws(
    () => assertPostVersion(current, 6),
    (error: unknown) => error instanceof ApiError
      && error.status === 409
      && error.code === 'POST_VERSION_CONFLICT'
      && (error.details as { recoverable?: boolean }).recoverable === true,
  );
  assert.doesNotThrow(() => assertPostVersion(current, 7));
});

test('ranked search keeps hostile parameters out of SQL text', () => {
  const hostileQuery = `x%' OR 1=1; DROP TABLE "Post"; --`;
  const hostileBoard = `free' OR '1'='1`;
  const statement = buildRankedPostSearch(hostileQuery, {
    board: hostileBoard,
    sort: 'popular',
    limit: 30,
  });
  const sqlText = statement.strings.join('');
  assert.equal(sqlText.includes(hostileQuery), false);
  assert.equal(sqlText.includes(hostileBoard), false);
  assert.ok(statement.values.includes(hostileQuery));
  assert.ok(statement.values.includes(hostileBoard));
  assert.match(sqlText, /ORDER BY/);
});
