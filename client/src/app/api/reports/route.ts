import type { ReportTargetType } from '@prisma/client';
import prisma from '@/lib/prisma';
import { reportLockKey } from '@/lib/server/domain/concurrency';
import {
  ApiError,
  assertSameOrigin,
  enforceDistributedRateLimit,
  enforceRateLimit,
  isUniqueConstraintError,
  json,
  jsonError,
  paginationMeta,
  parsePagination,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { lockResources } from '@/lib/server/locks';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReportBody {
  targetType?: unknown;
  targetId?: unknown;
  reasonCode?: unknown;
  detail?: unknown;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    enforceRateLimit(`report:${session.user.id}`, {
      limit: 20,
      windowMs: 24 * 60 * 60 * 1_000,
    });
    await enforceDistributedRateLimit(`report:${session.user.id}`, {
      limit: 20,
      windowMs: 24 * 60 * 60 * 1_000,
      failPolicy: 'open',
    });
    const body = await readJson<ReportBody>(request, 16_384);
    const targetTypes: ReportTargetType[] = ['USER', 'POST', 'COMMENT', 'MESSAGE'];
    if (!targetTypes.includes(body.targetType as ReportTargetType)) {
      throw new ApiError(400, 'INVALID_TARGET_TYPE', '신고 대상 유형이 올바르지 않습니다.');
    }
    const targetType = body.targetType as ReportTargetType;
    const targetId = requiredString(body.targetId, '신고 대상', { max: 64 });
    const reasonCode = requiredString(body.reasonCode, '신고 사유', { min: 2, max: 40 });
    const detail = typeof body.detail === 'string' ? body.detail.trim().slice(0, 1_000) || null : null;
    if (targetType === 'USER' && targetId === session.user.id) {
      throw new ApiError(400, 'SELF_REPORT', '자신을 신고할 수 없습니다.');
    }
    const targetField = {
      USER: { targetUserId: targetId },
      POST: { postId: targetId },
      COMMENT: { commentId: targetId },
      MESSAGE: { messageId: targetId },
    }[targetType];
    const report = await prisma.$transaction(async (tx) => {
      await lockResources(tx, [reportLockKey(session.user.id, targetType, targetId)]);
      const target =
        targetType === 'USER'
          ? await tx.user.findUnique({ where: { id: targetId }, select: { id: true } })
          : targetType === 'POST'
            ? await tx.post.findUnique({ where: { id: targetId }, select: { id: true } })
            : targetType === 'COMMENT'
              ? await tx.comment.findUnique({ where: { id: targetId }, select: { id: true } })
              : await tx.message.findFirst({
                  where: {
                    id: targetId,
                    room: {
                      members: {
                        some: { userId: session.user.id, leftAt: null },
                      },
                    },
                  },
                  select: { id: true },
                });
      if (!target) throw new ApiError(404, 'TARGET_NOT_FOUND', '신고 대상을 찾을 수 없습니다.');

      const recentDuplicate = await tx.report.findFirst({
        where: {
          reporterId: session.user.id,
          targetType,
          ...targetField,
          status: { in: ['OPEN', 'REVIEWING'] },
        },
        select: { id: true },
      });
      if (recentDuplicate) {
        throw new ApiError(409, 'ALREADY_REPORTED', '이미 검토 중인 신고가 있습니다.');
      }
      return tx.report.create({
        data: {
          reporterId: session.user.id,
          targetType,
          ...targetField,
          reasonCode,
          detail,
        },
      });
    });
    return json({ report }, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return jsonError(new ApiError(409, 'ALREADY_REPORTED', '이미 검토 중인 신고가 있습니다.'));
    }
    return jsonError(error);
  }
}

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const url = new URL(request.url);
    const { page, pageSize, skip } = parsePagination(url);
    const where = { reporterId: session.user.id };
    const [reports, total] = await prisma.$transaction([
      prisma.report.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
      prisma.report.count({ where }),
    ]);
    return json({ reports, pagination: paginationMeta(page, pageSize, total) });
  } catch (error) {
    return jsonError(error);
  }
}
