import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IGK_LEVELS,
  igkLevelForBalance,
  igkRankLabel,
  igkStanding,
} from '../src/lib/igk-levels';
import {
  SHOP_ITEMS,
  isShopItemAvailable,
  seoulShopSeason,
} from '../src/lib/igk-shop';

test('current IGK threshold boundaries level up and down deterministically', () => {
  for (const [index, rule] of IGK_LEVELS.entries()) {
    assert.equal(igkLevelForBalance(rule.minimumCurrentIgk).level, rule.level);
    if (index > 0) {
      assert.equal(
        igkLevelForBalance(rule.minimumCurrentIgk - 1).level,
        IGK_LEVELS[index - 1]?.level,
      );
    }
  }
  assert.equal(igkLevelForBalance(14_190).label, '조진');
  assert.equal(igkLevelForBalance(24_999).label, '조진');
  assert.equal(igkLevelForBalance(25_000).label, '조졸');
  assert.equal(igkLevelForBalance(0).label, '9등급');
});

test('tier and top-ten rank labels remain independent', () => {
  assert.deepEqual(igkStanding(11, 1), {
    level: 11,
    tierLabel: '조졸',
    rank: 1,
    rankLabel: '1짱',
  });
  assert.equal(igkRankLabel(10), '10짱');
  assert.equal(igkRankLabel(11), null);
  assert.equal(igkStanding(10, null).tierLabel, '조진');
});

test('shop has 24 permanent items and four coherent items per season', () => {
  assert.equal(SHOP_ITEMS.filter((item) => item.collection === 'core').length, 24);
  for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
    const items = SHOP_ITEMS.filter((item) => item.collection === season);
    assert.equal(items.length, 4);
    assert.deepEqual(new Set(items.map((item) => item.slot)), new Set(['avatarRing', 'profileTheme', 'postAccent', 'title']));
    assert.ok(items.every((item) => item.price >= 600 && item.price <= 1_400));
  }
});

test('seasonal availability follows Seoul calendar seasons', () => {
  const samples = [
    ['2026-03-01T00:00:00+09:00', 'spring'],
    ['2026-06-01T00:00:00+09:00', 'summer'],
    ['2026-09-01T00:00:00+09:00', 'autumn'],
    ['2026-12-01T00:00:00+09:00', 'winter'],
    ['2027-02-28T23:59:59+09:00', 'winter'],
  ] as const;
  for (const [timestamp, season] of samples) {
    const date = new Date(timestamp);
    assert.equal(seoulShopSeason(date), season);
    assert.equal(
      isShopItemAvailable(SHOP_ITEMS.find((item) => item.collection === season)!, date),
      true,
    );
  }
});
