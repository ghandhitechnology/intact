import type { UserStatus } from '@prisma/client';
import prisma from '@/lib/prisma';
import { adminUserSelect, publicAdminUser } from '@/lib/server/admin-users';
import { json, jsonError, paginationMeta, parsePagination } from '@/lib/server/http';
import { enrichPublicUserTree } from '@/lib/server/igk-standing';
import { requireReadyAdmin } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_FILTERS: Record<string, UserStatus> = {
  active: 'ACTIVE',
  suspended: 'SUSPENDED',
  reverify: 'PENDING_REVERIFICATION',
  graduated: 'GRADUATED',
  withdrawn: 'WITHDRAWN',
};

export async function GET(request: Request) {
  try {
    await requireReadyAdmin(request);
    const url = new URL(request.url);
    const query = url.searchParams.get('q')?.trim().slice(0, 80) ?? '';
    const status = STATUS_FILTERS[url.searchParams.get('status') ?? ''];
    const { page, pageSize, skip } = parsePagination(url, 50);
    const where = {
      ...(status ? { status } : {}),
      ...(query
        ? {
            OR: [
              { nickname: { contains: query, mode: 'insensitive' as const } },
              { loginId: { contains: query, mode: 'insensitive' as const } },
              { studentIdentity: { studentCode: { contains: query } } },
            ],
          }
        : {}),
    };

    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: adminUserSelect,
      }),
      prisma.user.count({ where }),
    ]);

    const activeSessions = users.length
      ? await prisma.session.groupBy({
          by: ['userId'],
          where: {
            userId: { in: users.map((user) => user.id) },
            scope: 'PORTAL',
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          _count: { id: true },
        })
      : [];
    const activeSessionCountByUser = new Map(
      activeSessions.map((entry) => [entry.userId, entry._count.id]),
    );

    const items = await enrichPublicUserTree(
      users.map((user) =>
        publicAdminUser({
          ...user,
          activeSessionCount: activeSessionCountByUser.get(user.id) ?? 0,
        }),
      ),
    );

    return json({ items, pagination: paginationMeta(page, pageSize, total) });
  } catch (error) {
    return jsonError(error);
  }
}
