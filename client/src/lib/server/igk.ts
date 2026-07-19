import type { IgkTransactionType, Prisma } from '@prisma/client';
import { ApiError } from '@/lib/server/http';

type Tx = Prisma.TransactionClient;

export async function lockIgkAccounts(tx: Tx, userIds: string[]) {
  const ordered = Array.from(new Set(userIds)).sort();
  for (const userId of ordered) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`igk:${userId}`}), hashtext('igk-account'))`;
  }
}

export function startOfSeoulDay() {
  const now = new Date();
  const seoul = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  seoul.setUTCHours(0, 0, 0, 0);
  return new Date(seoul.getTime() - 9 * 60 * 60 * 1000);
}

/**
 * Seoul calendar date encoded as UTC midnight, matching how Prisma stores
 * `@db.Date` values. Safe to compare against `User.lastAttendanceDate`.
 */
export function seoulCalendarDate(now = new Date()) {
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/** YYYY-MM-DD key for the current Seoul day (idempotency keys, source ids). */
export function seoulDateKey(now = new Date()) {
  return seoulCalendarDate(now).toISOString().slice(0, 10);
}

export async function levelForBalance(tx: Tx, currentIgk: number) {
  const rule = await tx.levelRule.findFirst({
    where: { minimumCurrentIgk: { lte: currentIgk } },
    orderBy: { minimumCurrentIgk: 'desc' },
    select: { level: true },
  });
  return rule?.level ?? 1;
}

export async function syncLevelForBalance(
  tx: Tx,
  user: { id: string; currentIgk: number; level: number },
) {
  const level = await levelForBalance(tx, user.currentIgk);
  if (level !== user.level) {
    await tx.user.update({ where: { id: user.id }, data: { level } });
  }
  return level;
}

export async function awardIgk(
  tx: Tx,
  input: {
    userId: string;
    amount: number;
    type: Extract<
      IgkTransactionType,
      | 'POST_CREATED'
      | 'COMMENT_CREATED'
      | 'RECOMMENDATION_RECEIVED'
      | 'ANSWER_ACCEPTED'
      | 'ATTENDANCE_REWARD'
    >;
    idempotencyKey: string;
    sourceType: string;
    sourceId: string;
    dailyCap: number;
    counterpartyId?: string;
    note?: string;
  },
) {
  await lockIgkAccounts(tx, [input.userId]);
  const existing = await tx.igkLedger.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;

  const today = await tx.igkLedger.aggregate({
    where: {
      userId: input.userId,
      type: input.type,
      amount: { gt: 0 },
      createdAt: { gte: startOfSeoulDay() },
    },
    _sum: { amount: true },
  });
  const remaining = Math.max(0, input.dailyCap - (today._sum.amount ?? 0));
  const amount = Math.min(input.amount, remaining);
  if (amount <= 0) return null;

  const userBeforeAward = await tx.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { igkDebt: true },
  });
  const debtPayment = Math.min(userBeforeAward.igkDebt, amount);
  const spendableAmount = amount - debtPayment;
  const updated = await tx.user.update({
    where: { id: input.userId },
    data: {
      currentIgk: { increment: spendableAmount },
      lifetimeIgk: { increment: amount },
      igkDebt: { decrement: debtPayment },
    },
    select: { currentIgk: true, lifetimeIgk: true, level: true, igkDebt: true },
  });
  await syncLevelForBalance(tx, { id: input.userId, ...updated });

  return tx.igkLedger.create({
    data: {
      userId: input.userId,
      counterpartyId: input.counterpartyId,
      type: input.type,
      amount,
      balanceAfter: updated.currentIgk,
      lifetimeAfter: updated.lifetimeIgk,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      note: input.note,
      metadata: debtPayment ? { debtPayment } : undefined,
    },
  });
}

export async function spendIgk(
  tx: Tx,
  input: {
    userId: string;
    amount: number;
    type: Extract<IgkTransactionType, 'SHOP_PURCHASE'>;
    idempotencyKey: string;
    sourceType: string;
    sourceId: string;
    note?: string;
  },
) {
  await lockIgkAccounts(tx, [input.userId]);
  const existing = await tx.igkLedger.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;

  // Spending changes currentIgk and can therefore lower the user's tier.
  const debited = await tx.user.updateMany({
    where: { id: input.userId, status: 'ACTIVE', currentIgk: { gte: input.amount } },
    data: { currentIgk: { decrement: input.amount } },
  });
  if (debited.count !== 1) {
    throw new ApiError(400, 'INSUFFICIENT_IGK', '보유 IGK가 부족합니다.');
  }
  const user = await tx.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { currentIgk: true, lifetimeIgk: true, level: true },
  });
  await syncLevelForBalance(tx, { id: input.userId, ...user });

  return tx.igkLedger.create({
    data: {
      userId: input.userId,
      type: input.type,
      amount: -input.amount,
      balanceAfter: user.currentIgk,
      lifetimeAfter: user.lifetimeIgk,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      note: input.note,
    },
  });
}

export async function reverseReward(
  tx: Tx,
  input: {
    userId: string;
    originalIdempotencyKey: string;
    idempotencyKey: string;
    sourceType: string;
    sourceId: string;
    note: string;
  },
) {
  await lockIgkAccounts(tx, [input.userId]);
  const existing = await tx.igkLedger.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;
  const original = await tx.igkLedger.findUnique({
    where: { idempotencyKey: input.originalIdempotencyKey },
  });
  if (!original || original.userId !== input.userId || original.amount <= 0) return null;
  const priorReversal = await tx.igkLedger.findFirst({
    where: {
      userId: input.userId,
      type: 'REVERSAL',
      metadata: { path: ['originalLedgerId'], equals: original.id },
    },
  });
  if (priorReversal) return priorReversal;

  const user = await tx.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { currentIgk: true, lifetimeIgk: true, igkDebt: true },
  });
  const balanceRecovered = Math.min(user.currentIgk, original.amount);
  const debtAdded = original.amount - balanceRecovered;
  const lifetimeRemoved = Math.min(user.lifetimeIgk, original.amount);
  const updated = await tx.user.update({
    where: { id: input.userId },
    data: {
      currentIgk: { decrement: balanceRecovered },
      lifetimeIgk: { decrement: lifetimeRemoved },
      igkDebt: { increment: debtAdded },
    },
    select: { currentIgk: true, lifetimeIgk: true, level: true, igkDebt: true },
  });
  await syncLevelForBalance(tx, { id: input.userId, ...updated });

  return tx.igkLedger.create({
    data: {
      userId: input.userId,
      type: 'REVERSAL',
      amount: -balanceRecovered,
      balanceAfter: updated.currentIgk,
      lifetimeAfter: updated.lifetimeIgk,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      note: input.note,
      metadata: {
        originalLedgerId: original.id,
        balanceRecovered,
        lifetimeRemoved,
        debtAdded,
      },
    },
  });
}
