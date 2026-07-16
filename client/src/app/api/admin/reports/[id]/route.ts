import prisma from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/server/audit';
import { ApiError, assertSameOrigin, json, jsonError, readJson, requiredString } from '@/lib/server/http';
import { requireReadyAdmin } from '@/lib/server/session';
import { createNotificationWithDelivery } from '@/lib/server/notifications';

export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    assertSameOrigin(request);
    const admin = await requireReadyAdmin(request);
    const body = await readJson<{ action?: unknown; resolution?: unknown; reason?: unknown }>(request);
    const actions = ['REVIEW', 'RESOLVE', 'DISMISS'] as const;
    if (!actions.includes(body.action as (typeof actions)[number])) {
      throw new ApiError(400, 'INVALID_ACTION', '지원하지 않는 신고 처리 작업입니다.');
    }
    const action = body.action as (typeof actions)[number];
    const reason = requiredString(body.reason, '처리 사유', { min: 2, max: 1_000 });
    const resolution = action === 'REVIEW'
      ? null
      : requiredString(body.resolution, '처리 결과', { min: 2, max: 1_000 });
    const before = await prisma.report.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, 'REPORT_NOT_FOUND', '신고를 찾을 수 없습니다.');
    const report = await prisma.$transaction(async (tx) => {
      const updated = await tx.report.update({
        where: { id: before.id },
        data: {
          status: action === 'REVIEW' ? 'REVIEWING' : action === 'RESOLVE' ? 'RESOLVED' : 'DISMISSED',
          resolution,
          resolvedAt: action === 'REVIEW' ? null : new Date(),
          resolvedById: action === 'REVIEW' ? null : admin.user.id,
        },
      });
      await createNotificationWithDelivery(tx, {
        userId: before.reporterId,
        actorId: admin.user.id,
        type: 'SYSTEM',
        title: action === 'REVIEW' ? '신고 검토가 시작되었습니다.' : '신고 처리가 완료되었습니다.',
        body: resolution ?? reason,
        href: '/notifications',
        metadata: { reportId: before.id, status: updated.status },
      });
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id,
        action: `REPORT_${action}`,
        targetType: 'REPORT',
        targetId: before.id,
        reason,
        before,
        after: updated,
      });
      return updated;
    });
    return json({ report });
  } catch (error) {
    return jsonError(error);
  }
}
