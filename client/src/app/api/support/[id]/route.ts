import prisma from '@/lib/prisma';
import { json, jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import { assertSupportTicketAccess, supportTicketHref } from '@/lib/server/support';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser(request);
    const { id } = await context.params;
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        assignedTo: { select: { id: true, nickname: true } },
        messages: {
          where: { isInternal: false },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            createdAt: true,
            body: true,
            authorId: true,
            author: { select: { id: true, nickname: true, role: true } },
          },
        },
        statusEvents: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, createdAt: true, fromStatus: true, toStatus: true },
        },
      },
    });
    assertSupportTicketAccess(ticket, session.user.id);
    return json({ ticket, href: supportTicketHref(id) });
  } catch (error) {
    return jsonError(error);
  }
}
