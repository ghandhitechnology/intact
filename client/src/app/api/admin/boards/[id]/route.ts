import type { BoardStatus } from '@prisma/client';
import prisma from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/server/audit';
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    assertSameOrigin(request);
    const admin = await requireReadyAdmin(request);
    const body = await readJson<Record<string, unknown>>(request);
    const reason = requiredString(body.reason, '처리 사유', { min: 2, max: 1_000 });
    const before = await prisma.board.findFirst({
      where: { OR: [{ id }, { slug: id }] },
    });
    if (!before) throw new ApiError(404, 'BOARD_NOT_FOUND', '게시판을 찾을 수 없습니다.');
    const statuses: BoardStatus[] = ['ACTIVE', 'HIDDEN', 'ARCHIVED'];
    const status = body.status && statuses.includes(body.status as BoardStatus)
      ? (body.status as BoardStatus)
      : before.status;
    const board = await prisma.$transaction(async (tx) => {
      const updated = await tx.board.update({
        where: { id: before.id },
        data: {
          name:
            body.name === undefined
              ? before.name
              : requiredString(body.name, '게시판 이름', { min: 2, max: 80 }),
          description:
            body.description === undefined
              ? before.description
              : requiredString(body.description, '게시판 설명', { min: 2, max: 300 }),
          status,
          sortOrder:
            body.sortOrder === undefined
              ? before.sortOrder
              : requiredInteger(body.sortOrder, '정렬 순서', -10_000, 10_000),
          allowAttachments:
            typeof body.allowAttachments === 'boolean'
              ? body.allowAttachments
              : before.allowAttachments,
          icon: typeof body.icon === 'string' ? body.icon.trim().slice(0, 64) || null : before.icon,
          accentColor:
            typeof body.accentColor === 'string'
              ? body.accentColor.trim().slice(0, 16) || null
              : before.accentColor,
        },
      });
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id,
        action: 'BOARD_UPDATE',
        targetType: 'BOARD',
        targetId: before.id,
        reason,
        before,
        after: updated,
      });
      return updated;
    });
    return json({ board });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    assertSameOrigin(request);
    const admin = await requireReadyAdmin(request);
    const body = await readJson<{ reason?: unknown }>(request);
    const reason = requiredString(body.reason, '보관 사유', { min: 2, max: 1_000 });
    const before = await prisma.board.findFirst({
      where: { OR: [{ id }, { slug: id }] },
    });
    if (!before) throw new ApiError(404, 'BOARD_NOT_FOUND', '게시판을 찾을 수 없습니다.');
    const board = await prisma.$transaction(async (tx) => {
      const updated = await tx.board.update({ where: { id: before.id }, data: { status: 'ARCHIVED' } });
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id,
        action: 'BOARD_ARCHIVE',
        targetType: 'BOARD',
        targetId: before.id,
        reason,
        before,
        after: updated,
      });
      return updated;
    });
    return json({ board });
  } catch (error) {
    return jsonError(error);
  }
}
