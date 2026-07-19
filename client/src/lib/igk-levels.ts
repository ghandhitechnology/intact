export const IGK_RANK_LIMIT = 10;

export const IGK_LEVELS = [
  { level: 1, minimumCurrentIgk: 0, label: '9등급' },
  { level: 2, minimumCurrentIgk: 100, label: '8등급' },
  { level: 3, minimumCurrentIgk: 250, label: '7등급' },
  { level: 4, minimumCurrentIgk: 500, label: '6등급' },
  { level: 5, minimumCurrentIgk: 1_000, label: '5등급' },
  { level: 6, minimumCurrentIgk: 2_000, label: '4등급' },
  { level: 7, minimumCurrentIgk: 3_500, label: '3등급' },
  { level: 8, minimumCurrentIgk: 5_750, label: '2등급' },
  { level: 9, minimumCurrentIgk: 9_125, label: '1등급' },
  { level: 10, minimumCurrentIgk: 14_190, label: '조진' },
  { level: 11, minimumCurrentIgk: 25_000, label: '조졸' },
] as const;

export type IgkLevelRule = (typeof IGK_LEVELS)[number];

export type IgkStanding = {
  level: number;
  tierLabel: string;
  rank: number | null;
  rankLabel: string | null;
};

export function igkTierLabel(level: number) {
  const normalized = Math.max(1, Math.min(IGK_LEVELS.length, Math.trunc(level) || 1));
  return IGK_LEVELS[normalized - 1]?.label ?? IGK_LEVELS[0].label;
}

/** Backwards-compatible tier label. Rank is deliberately rendered separately. */
export function igkLevelLabel(level: number, _legacyRank?: number | null) {
  return igkTierLabel(level);
}

export function igkRankLabel(rank?: number | null) {
  const normalized = Math.trunc(Number(rank));
  return normalized >= 1 && normalized <= IGK_RANK_LIMIT ? `${normalized}짱` : null;
}

export function igkLevelForBalance(currentIgk: number) {
  const normalized = Math.max(0, Math.trunc(currentIgk) || 0);
  return [...IGK_LEVELS]
    .reverse()
    .find((rule) => normalized >= rule.minimumCurrentIgk) ?? IGK_LEVELS[0];
}

export function igkStanding(level: number, rank?: number | null): IgkStanding {
  const normalizedRank = igkRankLabel(rank) ? Math.trunc(Number(rank)) : null;
  return {
    level,
    tierLabel: igkTierLabel(level),
    rank: normalizedRank,
    rankLabel: igkRankLabel(normalizedRank),
  };
}
