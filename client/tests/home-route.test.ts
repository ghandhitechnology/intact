import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import prisma from '../src/lib/prisma';
import { GET } from '../src/app/api/home/route';
import { anonymousNickname, primePlatformMode } from '../src/lib/server/platform-mode';

const viewerId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const publishedAt = new Date('2026-09-10T00:00:00.000Z');

function fixtures(t: TestContext, bSideEnabled = false) {
  function stub<T extends object, K extends keyof T>(target: T, key: K, replacement: (...args: unknown[]) => Promise<unknown>) {
    const original = target[key];
    const tracked = t.mock.fn(replacement);
    target[key] = tracked as T[K];
    t.after(() => { target[key] = original; });
    return tracked;
  }
  const originalSecret = process.env.PORTAL_ENCRYPTION_KEY;
  const originalRedis = process.env.REDIS_URL;
  const originalAdmin = process.env.ADMIN_INITIAL_PASSWORD;
  const originalFallback = process.env.NOTICE_REQUEST_SCHEDULER_FALLBACK;
  process.env.PORTAL_ENCRYPTION_KEY = 'synthetic-home-route-test';
  delete process.env.REDIS_URL;
  delete process.env.ADMIN_INITIAL_PASSWORD;
  delete process.env.NOTICE_REQUEST_SCHEDULER_FALLBACK;
  t.after(() => {
    for (const [key, value] of Object.entries({
      PORTAL_ENCRYPTION_KEY: originalSecret,
      REDIS_URL: originalRedis,
      ADMIN_INITIAL_PASSWORD: originalAdmin,
      NOTICE_REQUEST_SCHEDULER_FALLBACK: originalFallback,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  primePlatformMode({ bSideEnabled, bSideEpoch: 3, maintenanceEnabled: false, updatedAt: publishedAt });
  const user = {
    id: viewerId, nickname: '본인', realName: '본인 이름', role: 'USER', status: 'ACTIVE',
    currentIgk: 500, lifetimeIgk: 500, level: 4, reverifyDueAt: null,
    profileImage: '/self.png', studentIdentity: { studentCode: '311101', grade: 1 },
  };
  const other = {
    ...user, id: otherId, nickname: '다른 학생', realName: '다른 이름',
    profileImage: '/other.png', studentIdentity: { studentCode: '311102', grade: 1 },
  };
  const session = {
    id: 'session', user, scope: 'PORTAL', revokedAt: null as Date | null,
    expiresAt: new Date('2099-01-01'), lastSeenAt: new Date(),
  };
  const sessionRead = stub(prisma.session, 'findUnique', async () => session);
  stub(prisma.board, 'createMany', async () => ({ count: 0 }));
  stub(prisma.levelRule, 'createMany', async () => ({ count: 0 }));
  const boardRead = stub(prisma.board, 'findMany', async () => [{
    id: 'board', slug: 'free', name: '자유게시판', _count: { posts: 1 },
  }]);
  const postRead = stub(prisma.post, 'findMany', async () => [{ id: 'post', author: other, publishedAt }]);
  const noticeRead = stub(prisma.notice, 'findMany', async () => [{
    id: 'notice', title: '공지', author: { id: other.id, nickname: other.nickname, realName: other.realName },
  }]);
  stub(prisma.user, 'findMany', async () => [user, other]);
  const unreadRead = stub(prisma.notification, 'count', async () => 3);
  stub(prisma, '$queryRaw', async () => [{
    boardId: 'board', todayPosts: BigInt(1), todayComments: BigInt(2), weeklyPosts: BigInt(3), weeklyComments: BigInt(4),
    postIds: ['post'],
  }]);
  const unnecessaryReads = [
    stub(prisma.notification, 'findMany', async () => { throw new Error('알림 본문은 홈에 필요하지 않습니다.'); }),
    stub(prisma.user, 'findUniqueOrThrow', async () => { throw new Error('인증한 잔액을 재조회하지 않습니다.'); }),
    stub(prisma.levelRule, 'findMany', async () => { throw new Error('홈은 등급 규칙을 조회하지 않습니다.'); }),
    stub(prisma.user, 'count', async () => { throw new Error('홈은 전체 참여자 수를 조회하지 않습니다.'); }),
  ];
  const request = () => new Request('http://internal/api/home', {
    headers: { cookie: `igwak_session=${'x'.repeat(43)}`, 'if-none-match': 'old-home-etag' },
  });
  return { session, sessionRead, boardRead, postRead, noticeRead, unreadRead, unnecessaryReads, request };
}

test('홈은 한 번 인증하고 필요한 계정 요약만 조회하며 응답을 저장하지 않는다', async (t) => {
  const f = fixtures(t);
  const response = await GET(f.request());
  const { data } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(response.headers.get('x-request-id'));
  assert.equal(response.headers.get('etag'), null);
  assert.equal(f.sessionRead.mock.callCount(), 1);
  assert.deepEqual(f.unreadRead.mock.calls[0]?.arguments, [{ where: { userId: viewerId, readAt: null } }]);
  for (const read of f.unnecessaryReads) assert.equal(read.mock.callCount(), 0);
  assert.deepEqual(data.account, { currentIgk: 500, igkRank: 1, unreadCount: 3 });
  assert.deepEqual(data.sectionErrors, {});
  assert.deepEqual(data.boards[0].stats, { todayPosts: 1, todayComments: 2, weeklyPosts: 3, weeklyComments: 4 });
  const postArgs = f.postRead.mock.calls[0]?.arguments[0] as { where: { id: { in: string[] }; status: string } } | undefined;
  assert.deepEqual(postArgs?.where.id.in, ['post']);
  assert.equal(postArgs?.where.status, 'PUBLISHED');
});

test('홈의 B-side 응답은 타인의 게시글·공지·랭킹을 익명화하고 본인을 유지한다', async (t) => {
  const f = fixtures(t, true);
  const { data } = await (await GET(f.request())).json();
  const alias = anonymousNickname(otherId, 3);
  assert.equal(data.boards[0].posts[0].author.nickname, alias);
  assert.equal(data.boards[0].posts[0].author.studentIdentity.studentCode, '------');
  assert.equal(data.notices[0].author.realName, alias);
  assert.equal(data.leaders[1].nickname, alias);
  assert.equal(data.leaders[1].profileImage, null);
  assert.equal(data.leaders[0].nickname, '본인');
  assert.equal(data.leaders[0].studentIdentity.studentCode, '311101');
  assert.equal(data.leaders[0].igkRank, 1);
});

test('공지 조회 실패는 게시판과 계정 요약을 버리지 않는다', async (t) => {
  const f = fixtures(t);
  f.noticeRead.mock.mockImplementation(async () => { throw new Error('공지 조회 실패'); });
  const { data } = await (await GET(f.request())).json();
  assert.deepEqual(data.notices, []);
  assert.equal(data.boards.length, 1);
  assert.equal(data.leaders.length, 2);
  assert.equal(data.account.unreadCount, 3);
  assert.ok(data.sectionErrors.notices);
  assert.equal(Object.keys(data.sectionErrors).length, 1);
});

test('취소된 세션과 관리자 세션은 홈 조회를 시작하지 않는다', async (t) => {
  const f = fixtures(t);
  f.session.revokedAt = new Date();
  assert.equal((await GET(f.request())).status, 401);
  f.session.revokedAt = null;
  f.session.scope = 'ADMIN';
  assert.equal((await GET(f.request())).status, 401);
  f.session.scope = 'PORTAL';
  f.session.user.role = 'ADMIN';
  assert.equal((await GET(f.request())).status, 403);
  assert.equal(f.boardRead.mock.callCount(), 0);
  assert.equal(f.unreadRead.mock.callCount(), 0);
});
