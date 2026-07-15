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
import { getPlatformMode, maskPublicIdentitiesWithMode } from '@/lib/server/platform-mode';

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
    const platformMode = await getPlatformMode();
    const safeNotifications = maskPublicIdentitiesWithMode(
      notifications.map((notification) => {
        if (!platformMode.bSideEnabled) return notification;
        if (notification.type === 'MESSAGE') {
          return { ...notification, title: '새 메시지가 도착했습니다.' };
        }
        const metadata = notification.metadata && typeof notification.metadata === 'object'
          ? notification.metadata as Record<string, unknown>
          : null;
        if (notification.type === 'SYSTEM' && metadata?.transferId) {
          const amount = Number(metadata.amount);
          return {
            ...notification,
            title: Number.isFinite(amount) ? `${amount} IGK 선물을 받았습니다.` : 'IGK 선물을 받았습니다.',
          };
        }
        return notification;
      }),
      session.user.id,
      platformMode,
    );
    return json({
      notifications: safeNotifications,
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
