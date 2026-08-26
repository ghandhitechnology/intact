const DAY_MS = 24 * 60 * 60 * 1_000;

export const REVERIFICATION_WARNING_MS = 14 * DAY_MS;
export const REVERIFICATION_GRACE_MS = 7 * DAY_MS;

export type ReverificationState =
  | { kind: 'current' }
  | { kind: 'warning'; dueAt: string; requiredAt: string }
  | { kind: 'grace'; dueAt: string; requiredAt: string }
  | { kind: 'required'; dueAt: string; requiredAt: string };

export type PublicReverificationState = Exclude<
  ReverificationState,
  { kind: 'required' }
>;

export function getReverificationState(
  dueAt: Date | null,
  now = new Date(),
): ReverificationState {
  if (!dueAt) return { kind: 'current' };

  const dueTime = dueAt.getTime();
  const nowTime = now.getTime();
  const dueAtIso = dueAt.toISOString();
  const requiredAt = new Date(dueTime + REVERIFICATION_GRACE_MS).toISOString();
  if (nowTime < dueTime - REVERIFICATION_WARNING_MS) {
    return { kind: 'current' };
  }
  if (nowTime < dueTime) {
    return { kind: 'warning', dueAt: dueAtIso, requiredAt };
  }

  if (nowTime < dueTime + REVERIFICATION_GRACE_MS) {
    return { kind: 'grace', dueAt: dueAtIso, requiredAt };
  }
  return { kind: 'required', dueAt: dueAtIso, requiredAt };
}

export function getPublicReverificationState(
  dueAt: Date | null,
  now = new Date(),
): PublicReverificationState {
  const state = getReverificationState(dueAt, now);
  return state.kind === 'required' ? { kind: 'current' } : state;
}
