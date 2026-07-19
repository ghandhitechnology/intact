import prisma from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/server/audit';
import {
  ApiError,
  assertSameOrigin,
  enforceClientIpRateLimit,
  enforceRateLimit,
  json,
  jsonError,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { lockResources } from '@/lib/server/locks';
import { requireReadyAdmin } from '@/lib/server/session';
import {
  serializeAdminInvite,
  studentInviteAdminInclude,
} from '@/lib/server/student-invites';

export const runtime = 'nodejs';

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    enforceClientIpRateLimit(request, 'admin-invites-revoke', {
      limit: 120,
      windowMs: 60 * 60 * 1_000,
    });
    const admin = await requireReadyAdmin(request);
    enforceRateLimit(`admin-invites-revoke:${admin.user.id}`, {
      limit: 120,
      windowMs: 60 * 60 * 1_000,
    });
    const { id } = await context.params;
    const body = await readJson<{ reason?: unknown }>(request, 8_192);
    const reason = requiredString(body.reason, '취소 사유', { min: 2, max: 1_000 });
    const now = new Date();

    const invite = await prisma.$transaction(async (tx) => {
      await lockResources(tx, [`student-invite-id:${id}`]);
      const before = await tx.studentInvite.findUnique({
        where: { id },
        include: studentInviteAdminInclude,
      });
      if (!before) {
        throw new ApiError(404, 'INVITE_NOT_FOUND', '학생 초대를 찾을 수 없습니다.');
      }
      if (before.usedAt) {
        throw new ApiError(409, 'INVITE_ALREADY_USED', '이미 사용된 학생 초대는 취소할 수 없습니다.');
      }
      if (before.revokedAt) return before;

      const claimed = await tx.studentInvite.updateMany({
        where: { id, usedAt: null, revokedAt: null },
        data: {
          activeKey: null,
          revokedAt: now,
          revokedById: admin.user.id,
          revokedReason: reason,
        },
      });
      if (claimed.count !== 1) {
        throw new ApiError(409, 'INVITE_STATE_CHANGED', '초대 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요.');
      }
      const updated = await tx.studentInvite.findUniqueOrThrow({
        where: { id },
        include: studentInviteAdminInclude,
      });
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id,
        action: 'STUDENT_INVITE_REVOKE',
        targetType: 'STUDENT_INVITE',
        targetId: id,
        reason,
        before,
        after: updated,
      });
      return updated;
    });

    return json({ invite: serializeAdminInvite(invite, now) });
  } catch (error) {
    return jsonError(error);
  }
}
