import prisma from '@/lib/prisma';
import { json, jsonError, paginationMeta, parsePagination } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const url = new URL(request.url);
    const { page, pageSize, skip } = parsePagination(url, 100);
    const where = { userId: session.user.id };
    const [entries, total] = await prisma.$transaction([
      prisma.igkLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          createdAt: true,
          type: true,
          amount: true,
          balanceAfter: true,
          lifetimeAfter: true,
          sourceType: true,
          sourceId: true,
          note: true,
          counterparty: {
            select: {
              id: true,
              nickname: true, realName: true,
              studentIdentity: { select: { studentCode: true } },
            },
          },
        },
      }),
      prisma.igkLedger.count({ where }),
    ]);
    return json({ entries, pagination: paginationMeta(page, pageSize, total) });
  } catch (error) {
    return jsonError(error);
  }
}
