import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/server/audit';
import { lockIgkAccounts } from '@/lib/server/igk';
import {
  ApiError,
  assertSameOrigin,
  json,
  jsonError,
  readJson,
  requiredInteger,
  requiredString,
} from '@/lib/server/http';
import { requireReadyAdmin } from '@/lib/server/session';

export const runtime = 'nodejs';

type UserAction =
  | 'WARN'
  | 'SUSPEND'
  | 'BAN'
  | 'WITHDRAW'
  | 'RESTORE'
  | 'REVOKE_SESSIONS'
  | 'ADJUST_IGK';

interface UserMutationBody {
  action?: unknown;
  reason?: unknown;
  durationDays?: unknown;
  amount?: unknown;
}

const safeUserSelect = {
  id: true,
  loginId: true,
  nickname: true, realName: true,
  role: true,
  status: true,
  currentIgk: true,
  lifetimeIgk: true,
  igkDebt: true,
  level: true,
  withdrawnAt: true,
} as const;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    assertSameOrigin(request);
    const admin = await requireReadyAdmin(request);
    const body = await readJson<UserMutationBody>(request, 16_384);
    const actions: UserAction[] = [
      'WARN',
      'SUSPEND',
      'BAN',
      'WITHDRAW',
      'RESTORE',
      'REVOKE_SESSIONS',
      'ADJUST_IGK',
    ];
    if (!actions.includes(body.action as UserAction)) {
      throw new ApiError(400, 'INVALID_ACTION', '지원하지 않는 사용자 관리 작업입니다.');
    }
    const action = body.action as UserAction;
    const reason = requiredString(body.reason, '처리 사유', { min: 2, max: 1_000 });
    const target = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        loginId: true,
        nickname: true, realName: true,
        role: true,
        status: true,
        currentIgk: true,
        lifetimeIgk: true,
        level: true,
      },
    });
    if (!target) throw new ApiError(404, 'USER_NOT_FOUND', '사용자를 찾을 수 없습니다.');
    if (target.id === admin.user.id && ['SUSPEND', 'BAN', 'WITHDRAW'].includes(action)) {
      throw new ApiError(400, 'SELF_ADMIN_ACTION', '자신의 관리자 계정을 정지하거나 탈퇴시킬 수 없습니다.');
    }
    if (['ADMIN', 'DEVELOPER'].includes(target.role) && admin.user.role !== 'DEVELOPER' && target.id !== admin.user.id) {
      throw new ApiError(403, 'ADMIN_TARGET_FORBIDDEN', '다른 관리자 계정을 변경할 권한이 없습니다.');
    }

    const result = await prisma.$transaction(async (tx) => {
      let after: unknown = target;
      const now = new Date();
      if (action === 'WARN') {
        const sanction = await tx.sanction.create({
          data: {
            targetUserId: target.id,
            issuedById: admin.user.id,
            type: 'WARNING',
            reason,
          },
        });
        await tx.notification.create({
          data: {
            userId: target.id,
            actorId: admin.user.id,
            type: 'SANCTION',
            title: '관리자 경고가 등록되었습니다.',
            body: reason,
            href: '/notifications',
          },
        });
        after = sanction;
      } else if (action === 'SUSPEND') {
        const durationDays = requiredInteger(body.durationDays ?? 7, '정지 기간', 1, 365);
        const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1_000);
        const [user, sanction] = await Promise.all([
          tx.user.update({ where: { id: target.id }, data: { status: 'SUSPENDED' }, select: safeUserSelect }),
          tx.sanction.create({
            data: {
              targetUserId: target.id,
              issuedById: admin.user.id,
              type: 'TEMPORARY_SUSPENSION',
              reason,
              endsAt,
            },
          }),
        ]);
        await tx.session.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: now },
        });
        after = { user, sanction };
      } else if (action === 'BAN') {
        const [user, sanction] = await Promise.all([
          tx.user.update({ where: { id: target.id }, data: { status: 'SUSPENDED' }, select: safeUserSelect }),
          tx.sanction.create({
            data: {
              targetUserId: target.id,
              issuedById: admin.user.id,
              type: 'PERMANENT_BAN',
              reason,
            },
          }),
        ]);
        await tx.session.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: now },
        });
        after = { user, sanction };
      } else if (action === 'WITHDRAW') {
        after = await tx.user.update({
          where: { id: target.id },
          data: { status: 'WITHDRAWN', withdrawnAt: now },
          select: safeUserSelect,
        });
        await tx.session.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: now },
        });
      } else if (action === 'RESTORE') {
        after = await tx.user.update({
          where: { id: target.id },
          data: { status: 'ACTIVE', withdrawnAt: null },
          select: safeUserSelect,
        });
        await tx.sanction.updateMany({
          where: { targetUserId: target.id, revokedAt: null },
          data: { revokedAt: now, revokedById: admin.user.id },
        });
      } else if (action === 'REVOKE_SESSIONS') {
        const revoked = await tx.session.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: now },
        });
        after = { revokedSessions: revoked.count };
      } else {
        await lockIgkAccounts(tx, [target.id]);
        const requestedAmount = requiredInteger(body.amount, 'IGK 조정량', -100_000, 100_000);
        if (requestedAmount === 0) throw new ApiError(400, 'ZERO_ADJUSTMENT', 'IGK 조정량은 0일 수 없습니다.');
        const freshTarget = await tx.user.findUniqueOrThrow({
          where: { id: target.id },
          select: { currentIgk: true, igkDebt: true },
        });
        const actualAmount = Math.max(-freshTarget.currentIgk, requestedAmount);
        const debtPayment = requestedAmount > 0
          ? Math.min(freshTarget.igkDebt, requestedAmount)
          : 0;
        const updated = await tx.user.update({
          where: { id: target.id },
          data: {
            currentIgk: { increment: actualAmount - debtPayment },
            igkDebt: { decrement: debtPayment },
          },
          select: safeUserSelect,
        });
        await tx.igkLedger.create({
          data: {
            userId: target.id,
            counterpartyId: admin.user.id,
            type: 'ADMIN_ADJUSTMENT',
            amount: actualAmount,
            balanceAfter: updated.currentIgk,
            lifetimeAfter: updated.lifetimeIgk,
            sourceType: 'ADMIN',
            sourceId: admin.user.id,
            idempotencyKey: `admin-adjust:${randomUUID()}`,
            note: reason,
            metadata: debtPayment ? { debtPayment } : undefined,
          },
        });
        after = updated;
      }
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id,
        action: `USER_${action}`,
        targetType: 'USER',
        targetId: target.id,
        reason,
        before: target,
        after,
      });
      return after;
    });
    return json({ result });
  } catch (error) {
    return jsonError(error);
  }
}
