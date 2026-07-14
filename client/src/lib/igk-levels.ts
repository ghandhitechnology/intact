export const IGK_LEVELS = [
  { level: 1, minimumLifetimeIgk: 0, label: '9등급' },
  { level: 2, minimumLifetimeIgk: 100, label: '8등급' },
  { level: 3, minimumLifetimeIgk: 250, label: '7등급' },
  { level: 4, minimumLifetimeIgk: 500, label: '6등급' },
  { level: 5, minimumLifetimeIgk: 1_000, label: '5등급' },
  { level: 6, minimumLifetimeIgk: 2_000, label: '4등급' },
  { level: 7, minimumLifetimeIgk: 3_500, label: '3등급' },
  { level: 8, minimumLifetimeIgk: 5_750, label: '2등급' },
  { level: 9, minimumLifetimeIgk: 9_125, label: '1등급' },
  { level: 10, minimumLifetimeIgk: 14_190, label: '선생님' },
] as const;

export type IgkLevelRule = (typeof IGK_LEVELS)[number];

export function igkLevelLabel(level: number) {
  const normalized = Math.max(1, Math.min(IGK_LEVELS.length, Math.trunc(level) || 1));
  return IGK_LEVELS[normalized - 1]?.label ?? IGK_LEVELS[0].label;
}

export function igkLevelForLifetime(lifetimeIgk: number) {
  const normalized = Math.max(0, Math.trunc(lifetimeIgk) || 0);
  return [...IGK_LEVELS]
    .reverse()
    .find((rule) => normalized >= rule.minimumLifetimeIgk) ?? IGK_LEVELS[0];
}
