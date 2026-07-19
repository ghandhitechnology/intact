import type { SupportStatus } from '@prisma/client';
import prisma from '@/lib/prisma';
import { json, jsonError, paginationMeta, parsePagination } from '@/lib/server/http';
import { requireReadyAdmin } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireReadyAdmin(request);
    const url = new URL(request.url);
    const { page, pageSize, skip } = parsePagination(url, 100);
    const statuses: SupportStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
    const requestedStatus = url.searchParams.get('status') as SupportStatus | null;
    const where = requestedStatus && statuses.includes(requestedStatus) ? { status: requestedStatus } : {};
    const [tickets, total] = await prisma.$transaction([
      prisma.supportTicket.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: pageSize,
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
          _count: { select: { messages: true } },
          messages: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { id: true, createdAt: true, body: true, isInternal: true },
          },
        },
      }),
      prisma.supportTicket.count({ where }),
    ]);
    return json({ tickets, pagination: paginationMeta(page, pageSize, total) });
  } catch (error) {
    return jsonError(error);
  }
}
