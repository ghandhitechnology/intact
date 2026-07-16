import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  assertSameOrigin,
  enforceDistributedRateLimit,
  enforceRateLimit,
  json,
  jsonError,
  readJson,
  requiredString,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import {
  assertSupportTicketAccess,
  statusAfterRequesterReply,
  supportTicketHref,
} from '@/lib/server/support';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    const { id } = await context.params;
    enforceRateLimit(`support-reply:${session.user.id}`, { limit: 30, windowMs: 24 * 60 * 60 * 1_000 });
    await enforceDistributedRateLimit(`support-reply:${session.user.id}`, {
      limit: 30,
      windowMs: 24 * 60 * 60 * 1_000,
      failPolicy: 'open',
    });
    const body = await readJson<Record<string, unknown>>(request, 16_384);
    const messageBody = requiredString(body.body, '답글', { min: 2, max: 10_000, trim: false }).trim();
    const clientMessageId = typeof body.clientMessageId === 'string'
      ? requiredString(body.clientMessageId, '요청 식별자', { min: 8, max: 160 })
      : null;
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, requesterId: true, status: true },
    });
    assertSupportTicketAccess(ticket, session.user.id);

    if (clientMessageId) {
      const existing = await prisma.supportMessage.findFirst({
        where: {
          ticketId: id,
          authorId: session.user.id,
          metadata: { path: ['clientMessageId'], equals: clientMessageId },
        },
      });
      if (existing) return json({ message: existing, deduplicated: true, href: supportTicketHref(id) });
    }

    const nextStatus = statusAfterRequesterReply(ticket.status);
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.supportMessage.create({
        data: {
          ticketId: id,
          authorId: session.user.id,
          body: messageBody,
          metadata: clientMessageId
            ? ({ clientMessageId } satisfies Prisma.InputJsonObject)
            : undefined,
        },
      });
      await tx.supportTicket.update({
        where: { id },
        data: {
          status: nextStatus,
          resolvedAt: nextStatus === 'OPEN' ? null : undefined,
          updatedAt: new Date(),
        },
      });
      if (nextStatus !== ticket.status) {
        await tx.supportStatusEvent.create({
          data: {
            ticketId: id,
            changedById: session.user.id,
            fromStatus: ticket.status,
            toStatus: nextStatus,
            note: '요청자 답글로 문의 재개',
          },
        });
      }
      return created;
    });
    return json({ message, deduplicated: false, status: nextStatus, href: supportTicketHref(id) }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
