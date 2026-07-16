import prisma from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/server/audit';
import { ApiError, assertSameOrigin, json, jsonError, readJson, requiredString } from '@/lib/server/http';
import { requireReadyAdmin } from '@/lib/server/session';

export const runtime = 'nodejs';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireReadyAdmin(request);
    const { id } = await context.params;
    const body = await readJson<{ enabled?: unknown; reason?: unknown }>(request);
    if (typeof body.enabled !== 'boolean') throw new ApiError(400, 'INVALID_RULE_STATE', '활성화 상태가 필요합니다.');
    const reason = requiredString(body.reason, '변경 사유', { min: 2, max: 1000 });
    const before = await prisma.moderationRule.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, 'RULE_NOT_FOUND', '규칙을 찾을 수 없습니다.');
    const rule = await prisma.$transaction(async (tx) => {
      const updated = await tx.moderationRule.update({ where: { id }, data: { enabled: body.enabled as boolean } });
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id, action: body.enabled ? 'MODERATION_RULE_ENABLE' : 'MODERATION_RULE_DISABLE',
        targetType: 'MODERATION_RULE', targetId: id, reason, before, after: updated,
      });
      return updated;
    });
    return json({ rule });
  } catch (error) {
    return jsonError(error);
  }
}
