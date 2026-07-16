import assert from 'node:assert/strict';
import test from 'node:test';
import type { HomeLoaders } from '../src/lib/server/home-service';
import { loadHomeData } from '../src/lib/server/home-service';

function loaders(overrides: Partial<HomeLoaders> = {}): HomeLoaders {
  return {
    boards: async () => ({ boards: [{ id: 'board-1', slug: 'free', name: '자유게시판' }] }),
    notices: async () => ({ notices: [{ id: 'notice-1', title: '공지' }] }),
    leaders: async () => ({ leaders: [{ id: 'leader-1' }] }),
    notifications: async () => ({ unreadCount: 3 }),
    balance: async () => ({ currentIgk: 500, jojolRank: 2 }),
    ...overrides,
  };
}

test('keeps successful home sections when one loader fails', async () => {
  const data = await loadHomeData({
    request: new Request('http://internal/api/home'),
    currentIgk: 120,
    loaders: loaders({ notices: async () => { throw new Error('database unavailable'); } }),
    now: () => new Date('2026-07-17T00:00:00.000Z'),
  });

  assert.equal(data.boards.length, 1);
  assert.equal(data.leaders.length, 1);
  assert.deepEqual(data.notices, []);
  assert.equal(data.account.currentIgk, 500);
  assert.equal(data.account.unreadCount, 3);
  assert.equal(data.generatedAt, '2026-07-17T00:00:00.000Z');
  assert.deepEqual(data.sectionErrors.notices, {
    code: 'HOME_SECTION_FAILED',
    message: '홈 화면의 일부 정보를 불러오지 못했습니다.',
    retryable: true,
  });
});

test('falls back to session balance independently from notification failures', async () => {
  const data = await loadHomeData({
    request: new Request('http://internal/api/home'),
    currentIgk: 120,
    loaders: loaders({
      notifications: async () => { throw new Error('notifications failed'); },
      balance: async () => { throw new Error('balance failed'); },
    }),
  });

  assert.deepEqual(data.account, { currentIgk: 120, jojolRank: null, unreadCount: 0 });
  assert.ok(data.sectionErrors.notifications);
  assert.ok(data.sectionErrors.balance);
  assert.equal(data.boards.length, 1);
});
