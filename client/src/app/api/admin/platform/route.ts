import prisma from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/server/audit';
import { ApiError, assertSameOrigin, json, jsonError, readJson } from '@/lib/server/http';
import { getPlatformMode, primePlatformMode } from '@/lib/server/platform-mode';
import { requireReadyAdmin } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireReadyAdmin(request);
    const mode = await getPlatformMode({ fresh: true });
    return json(mode);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireReadyAdmin(request);
    const body = await readJson<{ enabled?: unknown }>(request, 4_096);
    if (typeof body.enabled !== 'boolean') {
      throw new ApiError(400, 'INVALID_B_SIDE_STATE', 'B-side 상태가 올바르지 않습니다.');
    }
    const enabled = body.enabled;

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.platformSetting.upsert({
        where: { id: 'global' },
        create: { id: 'global' },
        update: {},
      });
      const next = await tx.platformSetting.update({
        where: { id: 'global' },
        data: {
          bSideEnabled: enabled,
          bSideEpoch:
            enabled && !current.bSideEnabled
              ? { increment: 1 }
              : undefined,
        },
      });
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id,
        action: enabled ? 'B_SIDE_ENABLE' : 'B_SIDE_DISABLE',
        targetType: 'PLATFORM',
        targetId: 'global',
        reason: enabled ? '전역 B-side 활성화' : '전역 B-side 비활성화',
        before: current,
        after: next,
      });
      return next;
    });
    primePlatformMode(updated);
    return json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
