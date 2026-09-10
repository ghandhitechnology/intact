import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { adminUserSelect, publicAdminUser } from '@/lib/server/admin-users';
import { writeAdminAudit } from '@/lib/server/audit';
import { lockIgkAccounts, syncLevelForBalance } from '@/lib/server/igk';
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
import { createNotificationWithDelivery } from '@/lib/server/notifications';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireReadyAdmin(request);
    const { id } = await context.params;
    const user = await prisma.user.findUnique({ where: { id }, select: adminUserSelect });
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', '사용자를 찾을 수 없습니다.');
    const [sanctions, activeSessionCount] = await prisma.$transaction([
      prisma.sanction.findMany({
        where: { targetUserId: id },
        orderBy: { startsAt: 'desc' },
        take: 100,
        include: {
          issuedBy: { select: { id: true, nickname: true } },
          revokedBy: { select: { id: true, nickname: true } },
        },
      }),
      prisma.session.count({
        where: {
          userId: id,
          scope: 'PORTAL',
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      }),
    ]);
    return json({
      user: publicAdminUser({ ...user, activeSessionCount }),
      sanctions,
    });
  } catch (error) {
    return jsonError(error);
  }
}

type UserAction =
  | 'WARN'
  | 'SUSPEND'
  | 'BAN'
  | 'WITHDRAW'
  | 'RESTORE'
  | 'REVOKE_SESSIONS'
  | 'REVOKE_SANCTION'
  | 'ADJUST_IGK';

interface UserMutationBody {
  action?: unknown;
  reason?: unknown;
  durationDays?: unknown;
  amount?: unknown;
  direction?: unknown;
  sanctionId?: unknown;
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
      'REVOKE_SANCTION',
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
        igkDebt: true,
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
        await createNotificationWithDelivery(tx, {
          userId: target.id,
          actorId: admin.user.id,
          type: 'SANCTION',
          title: '관리자 경고가 등록되었습니다.',
          body: reason,
          href: '/notifications',
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
        await createNotificationWithDelivery(tx, {
          userId: target.id,
          actorId: admin.user.id,
          type: 'SANCTION',
          title: '계정이 일시 정지되었습니다.',
          body: `${durationDays}일 정지 · 사유: ${reason}`,
          href: '/notifications',
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
        await createNotificationWithDelivery(tx, {
          userId: target.id,
          actorId: admin.user.id,
          type: 'SANCTION',
          title: '계정이 영구 정지되었습니다.',
          body: `사유: ${reason}`,
          href: '/notifications',
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
        await createNotificationWithDelivery(tx, {
          userId: target.id,
          actorId: admin.user.id,
          type: 'SYSTEM',
          title: '계정이 탈퇴 처리되었습니다.',
          body: `사유: ${reason}`,
          href: '/notifications',
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
        await createNotificationWithDelivery(tx, {
          userId: target.id,
          actorId: admin.user.id,
          type: 'SYSTEM',
          title: '계정 제한이 해제되었습니다.',
          body: `사유: ${reason}`,
          href: '/notifications',
        });
      } else if (action === 'REVOKE_SANCTION') {
        const sanctionId = requiredString(body.sanctionId, '제재 ID', { min: 10, max: 64 });
        const sanction = await tx.sanction.findFirst({
          where: { id: sanctionId, targetUserId: target.id },
        });
        if (!sanction) throw new ApiError(404, 'SANCTION_NOT_FOUND', '해제할 제재를 찾을 수 없습니다.');
        if (sanction.revokedAt) {
          throw new ApiError(409, 'SANCTION_ALREADY_REVOKED', '이미 해제된 제재입니다.');
        }
        after = await tx.sanction.update({
          where: { id: sanction.id },
          data: { revokedAt: now, revokedById: admin.user.id },
        });
        await createNotificationWithDelivery(tx, {
          userId: target.id,
          actorId: admin.user.id,
          type: 'SANCTION',
          title: '제재가 해제되었습니다.',
          body: sanction.reason,
          href: '/notifications',
        });
      } else if (action === 'REVOKE_SESSIONS') {
        const revoked = await tx.session.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: now },
        });
        after = { revokedSessions: revoked.count };
      } else {
        await lockIgkAccounts(tx, [target.id]);
        const legacyAmount = requiredInteger(body.amount, 'IGK 조정량', -100_000, 100_000);
        const direction = body.direction === 'GRANT' || body.direction === 'TAKE' ? body.direction : null;
        const requestedAmount = direction
          ? Math.abs(legacyAmount) * (direction === 'GRANT' ? 1 : -1)
          : legacyAmount;
        if (requestedAmount === 0) throw new ApiError(400, 'ZERO_ADJUSTMENT', 'IGK 조정량은 0일 수 없습니다.');
        const requestKey = request.headers.get('idempotency-key')?.trim().slice(0, 100) || randomUUID();
        const idempotencyKey = `admin-adjust:${admin.user.id}:${target.id}:${requestKey}`;
        const completed = await tx.igkLedger.findUnique({ where: { idempotencyKey } });
        if (completed) {
          after = await tx.user.findUniqueOrThrow({ where: { id: target.id }, select: safeUserSelect });
          return after;
        }
        const freshTarget = await tx.user.findUniqueOrThrow({
          where: { id: target.id },
          select: { currentIgk: true, lifetimeIgk: true, level: true },
        });
        const actualAmount = Math.max(-freshTarget.currentIgk, requestedAmount);
        if (actualAmount === 0) {
          throw new ApiError(409, 'NO_IGK_TO_REMOVE', '회수할 수 있는 IGK 잔액이 없습니다.');
        }
        let updated = await tx.user.update({
          where: { id: target.id },
          data: {
            currentIgk: { increment: actualAmount },
          },
          select: safeUserSelect,
        });
        const level = await syncLevelForBalance(tx, updated);
        if (level !== updated.level) updated = { ...updated, level };
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
            idempotencyKey,
            note: reason,
            metadata: { requestedAmount, actualAmount, direction: actualAmount > 0 ? 'GRANT' : 'TAKE' },
          },
        });
        await createNotificationWithDelivery(tx, {
          userId: target.id,
          actorId: admin.user.id,
          type: 'SYSTEM',
          title: `관리자가 IGK를 ${actualAmount > 0 ? '지급' : '회수'}했습니다.`,
          body: `${actualAmount > 0 ? '+' : ''}${actualAmount.toLocaleString('ko-KR')} IGK · ${reason}`,
          href: '/igk',
          metadata: {
            requestedAmount,
            actualAmount,
            balanceAfter: updated.currentIgk,
            lifetimeAfter: updated.lifetimeIgk,
            level: updated.level,
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
