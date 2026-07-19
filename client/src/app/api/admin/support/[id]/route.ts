import type { SupportStatus } from '@prisma/client';
import prisma from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/server/audit';
import { ApiError, assertSameOrigin, json, jsonError, readJson, requiredString } from '@/lib/server/http';
import { createNotificationWithDelivery } from '@/lib/server/notifications';
import { requireReadyAdmin } from '@/lib/server/session';
import {
  SUPPORT_STATUSES,
  assertSupportStatusTransition,
  supportTicketHref,
} from '@/lib/server/support';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireReadyAdmin(request);
    const { id } = await context.params;
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        requester: {
          select: {
            id: true,
            nickname: true,
            realName: true,
            studentIdentity: { select: { studentCode: true } },
          },
        },
        assignedTo: { select: { id: true, nickname: true } },
        messages: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { author: { select: { id: true, nickname: true, role: true } } },
        },
        statusEvents: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { changedBy: { select: { id: true, nickname: true, role: true } } },
        },
      },
    });
    if (!ticket) throw new ApiError(404, 'SUPPORT_TICKET_NOT_FOUND', '문의를 찾을 수 없습니다.');
    return json({ ticket, href: supportTicketHref(id, true), requesterHref: supportTicketHref(id) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    assertSameOrigin(request);
    const admin = await requireReadyAdmin(request);
    const body = await readJson<Record<string, unknown>>(request);
    if (!SUPPORT_STATUSES.includes(body.status as SupportStatus)) {
      throw new ApiError(400, 'INVALID_STATUS', '문의 처리 상태가 올바르지 않습니다.');
    }
    const status = body.status as SupportStatus;
    const reason = requiredString(body.reason, '처리 사유', { min: 2, max: 1_000 });
    const resolution = status === 'RESOLVED' || status === 'CLOSED'
      ? requiredString(body.resolution, '답변', { min: 2, max: 2_000 })
      : typeof body.resolution === 'string'
        ? body.resolution.trim().slice(0, 2_000) || null
        : null;
    const before = await prisma.supportTicket.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, 'SUPPORT_TICKET_NOT_FOUND', '문의를 찾을 수 없습니다.');
    assertSupportStatusTransition(before.status, status);

    const ticket = await prisma.$transaction(async (tx) => {
      const updated = await tx.supportTicket.update({
        where: { id: before.id },
        data: {
          status,
          assignedToId: admin.user.id,
          resolution,
          resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? new Date() : null,
        },
      });
      if (status !== before.status) {
        await tx.supportStatusEvent.create({
          data: {
            ticketId: before.id,
            changedById: admin.user.id,
            fromStatus: before.status,
            toStatus: status,
            note: reason,
          },
        });
      }
      await createNotificationWithDelivery(tx, {
        userId: before.requesterId,
        actorId: admin.user.id,
        type: 'SYSTEM',
        title: '문의 처리 상태가 변경되었습니다.',
        body: resolution ?? reason,
        href: supportTicketHref(before.id),
        metadata: { supportTicketId: before.id, status },
      });
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id,
        action: 'SUPPORT_UPDATE',
        targetType: 'SUPPORT_TICKET',
        targetId: before.id,
        reason,
        before,
        after: updated,
      });
      return updated;
    });
    return json({ ticket, href: supportTicketHref(id, true), requesterHref: supportTicketHref(id) });
  } catch (error) {
    return jsonError(error);
  }
}
