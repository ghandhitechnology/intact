import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { loadBoardOverview } from '../src/lib/server/board-reads';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('게시판 요약은 공개된 글 다섯 개만 고정 글 우선으로 표시한다', {
  skip: !databaseUrl,
}, async () => {
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const rollback = new Error('테스트 데이터 롤백');
  try {
    await assert.rejects(client.$transaction(async (tx) => {
      const authorId = randomUUID();
      await tx.user.create({ data: {
        id: authorId, loginId: `test-${authorId.slice(0, 20)}`, nickname: `test-${authorId.slice(0, 20)}`,
        passwordHash: 'integration-test-only', role: 'TEACHER',
      } });
      const boardId = randomUUID();
      const emptyBoardId = randomUUID();
      const hiddenBoardId = randomUUID();
      await tx.board.createMany({ data: [boardId, emptyBoardId, hiddenBoardId].map((id) => ({
        id, slug: `test-${id}`, name: '조회 테스트', description: '합성 게시판',
        status: id === hiddenBoardId ? 'HIDDEN' as const : 'ACTIVE' as const,
      })) });
      const now = new Date('2026-09-11T03:00:00Z');
      const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
      const visibleIds = Array.from({ length: 12 }, () => randomUUID());
      const futureId = randomUUID();
      const hiddenId = randomUUID();
      await tx.post.createMany({ data: [
        ...visibleIds.map((id, index) => ({ id, publishedAt: minutesAgo(index + 1), isPinned: index === 11 })),
        { id: futureId, publishedAt: minutesAgo(-60) },
        { id: hiddenId, publishedAt: minutesAgo(0), status: 'HIDDEN' as const },
      ].map((post) => ({
        ...post, boardId, authorId, kind: 'STANDARD' as const, title: '합성 게시글',
        content: '합성 본문', contentText: '합성 본문',
      })) });

      const boards = await loadBoardOverview(tx, now);
      const board = boards.find((value) => value.id === boardId)!;
      assert.deepEqual(board.posts.map((post) => post.id), [visibleIds[11], ...visibleIds.slice(0, 4)]);
      assert.equal(board.posts[0].author.id, authorId);
      assert.equal(board.posts[0].contentText, '합성 본문');
      assert.deepEqual(board.posts[0].attachments, []);
      assert.equal(board._count.posts, 13);
      assert.deepEqual(board.stats, { todayPosts: 12, weeklyPosts: 12, todayComments: 0, weeklyComments: 0 });
      assert.deepEqual(boards.find((value) => value.id === emptyBoardId)?.posts, []);
      assert.equal(boards.some((value) => value.id === hiddenBoardId), false);
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally {
    await client.$disconnect();
  }
});
