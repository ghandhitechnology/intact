import prisma from '@/lib/prisma';
import {
  assertSameOrigin,
  json,
  jsonError,
  paginationMeta,
  parsePagination,
  readJson,
} from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const url = new URL(request.url);
    const { page, pageSize, skip } = parsePagination(url, 100);
    const unreadOnly = url.searchParams.get('unread') === 'true';
    const where = { userId: session.user.id, ...(unreadOnly ? { readAt: null } : {}) };
    const [notifications, total, unreadCount] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          actor: {
            select: {
              id: true,
              nickname: true, realName: true,
              profileImage: true,
              studentIdentity: { select: { studentCode: true } },
            },
          },
        },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: session.user.id, readAt: null } }),
    ]);
    return json({
      notifications,
      unreadCount,
      pagination: paginationMeta(page, pageSize, total),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ ids?: unknown; all?: unknown }>(request, 16_384);
    const ids = Array.isArray(body.ids)
      ? Array.from(new Set(body.ids.filter((id): id is string => typeof id === 'string'))).slice(0, 100)
      : [];
    const result = await prisma.notification.updateMany({
      where: {
        userId: session.user.id,
        readAt: null,
        ...(body.all === true ? {} : { id: { in: ids } }),
      },
      data: { readAt: new Date() },
    });
    return json({ markedRead: result.count });
  } catch (error) {
    return jsonError(error);
  }
}
