import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/server/audit';
import {
  ApiError,
  assertSameOrigin,
  enforceRateLimit,
  json,
  jsonError,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { createNotificationWithDelivery } from '@/lib/server/notifications';
import { requireReadyAdmin } from '@/lib/server/session';
import { supportTicketHref } from '@/lib/server/support';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const admin = await requireReadyAdmin(request);
    const { id } = await context.params;
    enforceRateLimit(`admin-support-reply:${admin.user.id}`, { limit: 120, windowMs: 60 * 60 * 1_000 });
    const body = await readJson<Record<string, unknown>>(request, 16_384);
    const messageBody = requiredString(body.body, '답글', { min: 2, max: 10_000, trim: false }).trim();
    const isInternal = body.isInternal === true;
    const clientMessageId = typeof body.clientMessageId === 'string'
      ? requiredString(body.clientMessageId, '요청 식별자', { min: 8, max: 160 })
      : null;
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, requesterId: true, status: true, subject: true },
    });
    if (!ticket) throw new ApiError(404, 'SUPPORT_TICKET_NOT_FOUND', '문의를 찾을 수 없습니다.');

    if (clientMessageId) {
      const existing = await prisma.supportMessage.findFirst({
        where: {
          ticketId: id,
          authorId: admin.user.id,
          metadata: { path: ['clientMessageId'], equals: clientMessageId },
        },
      });
      if (existing) {
        return json({ message: existing, deduplicated: true, href: supportTicketHref(id, true) });
      }
    }

    const nextStatus = ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status;
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.supportMessage.create({
        data: {
          ticketId: id,
          authorId: admin.user.id,
          body: messageBody,
          isInternal,
          metadata: clientMessageId
            ? ({ clientMessageId } satisfies Prisma.InputJsonObject)
            : undefined,
        },
      });
      await tx.supportTicket.update({
        where: { id },
        data: {
          assignedToId: admin.user.id,
          status: nextStatus,
          updatedAt: new Date(),
        },
      });
      if (nextStatus !== ticket.status) {
        await tx.supportStatusEvent.create({
          data: {
            ticketId: id,
            changedById: admin.user.id,
            fromStatus: ticket.status,
            toStatus: nextStatus,
            note: '관리자 답글 작성',
          },
        });
      }
      if (!isInternal) {
        await createNotificationWithDelivery(tx, {
          userId: ticket.requesterId,
          actorId: admin.user.id,
          type: 'SYSTEM',
          title: '문의에 새 답변이 등록되었습니다.',
          body: messageBody.slice(0, 500),
          href: supportTicketHref(id),
          metadata: { supportTicketId: id, supportMessageId: created.id },
        });
      }
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id,
        action: isInternal ? 'SUPPORT_INTERNAL_NOTE' : 'SUPPORT_REPLY',
        targetType: 'SUPPORT_TICKET',
        targetId: id,
        reason: isInternal ? '내부 메모 작성' : '요청자 답변 작성',
        before: ticket,
        after: { messageId: created.id, status: nextStatus, isInternal },
      });
      return created;
    });
    return json({
      message,
      deduplicated: false,
      status: nextStatus,
      href: supportTicketHref(id, true),
      requesterHref: supportTicketHref(id),
    }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
