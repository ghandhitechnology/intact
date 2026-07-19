import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  assertSameOrigin,
  json,
  jsonError,
  paginationMeta,
  parsePagination,
  readJson,
} from '@/lib/server/http';
import {
  decodeNotificationCursor,
  encodeNotificationCursor,
  notificationCursorWhere,
} from '@/lib/server/notifications';
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
    const cursor = decodeNotificationCursor(url.searchParams.get('cursor'));
    const baseWhere: Prisma.NotificationWhereInput = {
      userId: session.user.id,
      ...(unreadOnly ? { readAt: null } : {}),
    };
    const where: Prisma.NotificationWhereInput = cursor
      ? { AND: [baseWhere, notificationCursorWhere(cursor)] }
      : baseWhere;
    const [rows, total, unreadCount] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: cursor ? undefined : skip,
        take: pageSize + 1,
        include: {
          actor: {
            select: {
              id: true,
              nickname: true,
              realName: true,
              profileImage: true,
              studentIdentity: { select: { studentCode: true } },
            },
          },
        },
      }),
      prisma.notification.count({ where: baseWhere }),
      prisma.notification.count({ where: { userId: session.user.id, readAt: null } }),
    ]);
    const hasMore = rows.length > pageSize;
    const notifications = rows.slice(0, pageSize);
    const last = notifications.at(-1);
    const nextCursor = hasMore && last
      ? encodeNotificationCursor({ createdAt: last.createdAt, id: last.id })
      : null;
    const platformMode = await getPlatformMode();
    const safeNotifications = await maskPublicIdentitiesWithMode(
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
      cursor: { nextCursor, hasMore },
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
