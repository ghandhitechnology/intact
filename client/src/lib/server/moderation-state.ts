import { Prisma, type ModerationState } from '@prisma/client';

export type ModerationTransitionActor =
  | 'WORKER_CLAIM'
  | 'WORKER_RESULT'
  | 'ADMIN_REVIEW'
  | 'ADMIN_RETRY'
  | 'SYSTEM_SUPERSEDE';

export type AdminModerationAction = 'APPROVE' | 'REJECT' | 'RETRY';

export type ModerationTransitionSnapshot = {
  state: ModerationState;
  transitionVersion: number;
  leaseToken: string | null;
  latest: boolean;
};

export type ModerationTransitionExpectation = Pick<
  ModerationTransitionSnapshot,
  'state' | 'transitionVersion' | 'leaseToken'
>;

export type ModerationControlRecord = ModerationTransitionExpectation & {
  id: string;
  postId: string;
  createdAt: Date;
};

type Tx = Prisma.TransactionClient;

const TERMINAL_STATES = new Set<ModerationState>(['ALLOWED', 'BLOCKED', 'SUPERSEDED']);
const REVIEWABLE_STATES = new Set<ModerationState>(['NEEDS_REVIEW', 'FAILED']);
const NONTERMINAL_STATES = new Set<ModerationState>([
  'QUEUED',
  'PROCESSING',
  'NEEDS_REVIEW',
  'FAILED',
]);

export function isTerminalModerationState(state: ModerationState) {
  return TERMINAL_STATES.has(state);
}

export function isNonterminalModerationState(state: ModerationState) {
  return NONTERMINAL_STATES.has(state);
}

export function canAdminModerationAction(state: ModerationState, action: AdminModerationAction) {
  if (action === 'APPROVE' || action === 'REJECT' || action === 'RETRY') {
    return REVIEWABLE_STATES.has(state);
  }
  return false;
}

export function canModerationTransition(
  from: ModerationState,
  to: ModerationState,
  actor: ModerationTransitionActor,
) {
  if (isTerminalModerationState(from)) return false;
  if (actor === 'WORKER_CLAIM') {
    return to === 'PROCESSING' && (from === 'QUEUED' || from === 'PROCESSING');
  }
  if (actor === 'WORKER_RESULT') {
    return from === 'PROCESSING' && ['ALLOWED', 'BLOCKED', 'NEEDS_REVIEW', 'FAILED'].includes(to);
  }
  if (actor === 'ADMIN_REVIEW') {
    return REVIEWABLE_STATES.has(from) && (to === 'ALLOWED' || to === 'BLOCKED');
  }
  if (actor === 'ADMIN_RETRY') {
    return REVIEWABLE_STATES.has(from) && to === 'QUEUED';
  }
  return isNonterminalModerationState(from) && to === 'SUPERSEDED';
}

export function transitionModerationSnapshot(
  current: ModerationTransitionSnapshot,
  expected: ModerationTransitionExpectation,
  to: ModerationState,
  actor: ModerationTransitionActor,
  nextLeaseToken: string | null = null,
): ModerationTransitionSnapshot | null {
  if (
    !current.latest
    || current.state !== expected.state
    || current.transitionVersion !== expected.transitionVersion
    || current.leaseToken !== expected.leaseToken
    || !canModerationTransition(current.state, to, actor)
  ) {
    return null;
  }
  return {
    state: to,
    transitionVersion: current.transitionVersion + 1,
    leaseToken: nextLeaseToken,
    latest: true,
  };
}

export async function lockModerationPost(tx: Tx, postId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Post"
    WHERE "id" = ${postId}::uuid
    FOR UPDATE
  `);
  return rows.length === 1;
}

export async function lockModerationPostAndSubmission(tx: Tx, submissionId: string) {
  const pointer = await tx.$queryRaw<Array<{ postId: string }>>(Prisma.sql`
    SELECT "postId"
    FROM "ModerationSubmission"
    WHERE "id" = ${submissionId}::uuid
  `);
  const postId = pointer[0]?.postId;
  if (!postId || !await lockModerationPost(tx, postId)) return null;
  const rows = await tx.$queryRaw<ModerationControlRecord[]>(Prisma.sql`
    SELECT "id", "postId", "createdAt", "state", "transitionVersion", "leaseToken"
    FROM "ModerationSubmission"
    WHERE "id" = ${submissionId}::uuid
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

export async function isLatestModerationSubmission(tx: Tx, submission: Pick<ModerationControlRecord, 'id' | 'postId'>) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "ModerationSubmission"
    WHERE "postId" = ${submission.postId}::uuid
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT 1
  `);
  return rows[0]?.id === submission.id;
}

export async function readLatestModerationControl(tx: Tx, postId: string) {
  const rows = await tx.$queryRaw<ModerationControlRecord[]>(Prisma.sql`
    SELECT "id", "postId", "createdAt", "state", "transitionVersion", "leaseToken"
    FROM "ModerationSubmission"
    WHERE "postId" = ${postId}::uuid
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function compareAndSwapModerationState(
  tx: Tx,
  id: string,
  expected: ModerationTransitionExpectation,
  to: ModerationState,
  actor: ModerationTransitionActor,
  now = new Date(),
) {
  if (!canModerationTransition(expected.state, to, actor)) return null;
  const leaseGuard = expected.leaseToken === null
    ? Prisma.sql`target."leaseToken" IS NULL`
    : Prisma.sql`target."leaseToken" = ${expected.leaseToken}::uuid`;
  const completedAt = to === 'QUEUED' || to === 'PROCESSING' ? null : now;
  const rows = await tx.$queryRaw<Array<{ transitionVersion: number }>>(Prisma.sql`
    UPDATE "ModerationSubmission" AS target
    SET "state" = ${to}::"ModerationState",
        "transitionVersion" = target."transitionVersion" + 1,
        "leaseToken" = NULL,
        "leaseExpiresAt" = NULL,
        "claimedAt" = CASE WHEN ${to}::"ModerationState" = 'QUEUED' THEN NULL ELSE target."claimedAt" END,
        "completedAt" = ${completedAt},
        "updatedAt" = ${now}
    WHERE target."id" = ${id}::uuid
      AND target."state" = ${expected.state}::"ModerationState"
      AND target."transitionVersion" = ${expected.transitionVersion}
      AND ${leaseGuard}
      AND NOT EXISTS (
        SELECT 1
        FROM "ModerationSubmission" AS newer
        WHERE newer."postId" = target."postId"
          AND (newer."createdAt", newer."id") > (target."createdAt", target."id")
      )
    RETURNING target."transitionVersion"
  `);
  return rows[0]?.transitionVersion ?? null;
}

export async function claimNextModerationSubmission(
  tx: Tx,
  input: { now: Date; leaseExpiresAt: Date; leaseToken: string },
) {
  const rows = await tx.$queryRaw<ModerationControlRecord[]>(Prisma.sql`
    WITH candidate AS (
      SELECT candidate_source."id"
      FROM "ModerationSubmission" AS candidate_source
      WHERE (
        candidate_source."state" = 'QUEUED'
        OR (candidate_source."state" = 'PROCESSING' AND candidate_source."leaseExpiresAt" < ${input.now})
      )
        AND candidate_source."attemptCount" < 3
        AND NOT EXISTS (
          SELECT 1
          FROM "ModerationSubmission" AS newer
          WHERE newer."postId" = candidate_source."postId"
            AND (newer."createdAt", newer."id") > (candidate_source."createdAt", candidate_source."id")
        )
      ORDER BY candidate_source."createdAt" ASC, candidate_source."id" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "ModerationSubmission" AS claimed
    SET "state" = 'PROCESSING',
        "transitionVersion" = claimed."transitionVersion" + 1,
        "leaseToken" = ${input.leaseToken}::uuid,
        "claimedAt" = ${input.now},
        "leaseExpiresAt" = ${input.leaseExpiresAt},
        "attemptCount" = claimed."attemptCount" + 1,
        "completedAt" = NULL,
        "updatedAt" = ${input.now}
    FROM candidate
    WHERE claimed."id" = candidate."id"
    RETURNING claimed."id", claimed."postId", claimed."createdAt", claimed."state",
              claimed."transitionVersion", claimed."leaseToken"
  `);
  return rows[0] ?? null;
}
