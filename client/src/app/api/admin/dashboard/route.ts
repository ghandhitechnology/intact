import prisma from '@/lib/prisma';
import { json, jsonError } from '@/lib/server/http';
import { requireReadyAdmin } from '@/lib/server/session';
import { getPlatformMode } from '@/lib/server/platform-mode';
import { getRiroBridgeStatus } from '@/lib/server/riro-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const admin = await requireReadyAdmin(request);
    const now = new Date();
    const seoulOffsetMs = 9 * 60 * 60 * 1_000;
    const seoulNow = new Date(now.getTime() + seoulOffsetMs);
    const todayStart = new Date(
      Date.UTC(seoulNow.getUTCFullYear(), seoulNow.getUTCMonth(), seoulNow.getUTCDate()) -
        seoulOffsetMs,
    );
    const [
      posts,
      comments,
      notices,
      reports,
      auditLog,
      userCount,
      postCount,
      openReportCount,
      newUsersToday,
      todayPosts,
      todayComments,
    ] =
      await prisma.$transaction([
        prisma.post.findMany({
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: {
            board: { select: { slug: true, name: true } },
            author: {
              select: {
                id: true,
                nickname: true, realName: true,
                studentIdentity: { select: { studentCode: true } },
              },
            },
            _count: {
              select: { reports: { where: { status: { in: ['OPEN', 'REVIEWING'] } } } },
            },
          },
        }),
        prisma.comment.findMany({
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: {
            post: {
              select: {
                id: true,
                title: true,
                board: { select: { slug: true, name: true } },
              },
            },
            author: {
              select: {
                id: true,
                nickname: true, realName: true,
                studentIdentity: { select: { studentCode: true } },
              },
            },
            _count: {
              select: { reports: { where: { status: { in: ['OPEN', 'REVIEWING'] } } } },
            },
          },
        }),
        prisma.notice.findMany({
          where: { status: { not: 'DELETED' } },
          orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
          take: 100,
          include: { author: { select: { id: true, nickname: true } } },
        }),
        prisma.report.findMany({
          where: { status: { in: ['OPEN', 'REVIEWING'] } },
          orderBy: { createdAt: 'asc' },
          take: 100,
          include: {
            reporter: { select: { id: true, nickname: true } },
            targetUser: { select: { id: true, nickname: true } },
            post: {
              select: {
                id: true,
                title: true,
                status: true,
                author: { select: { id: true, nickname: true } },
                board: { select: { slug: true, name: true } },
              },
            },
            comment: {
              select: {
                id: true,
                content: true,
                status: true,
                author: { select: { id: true, nickname: true } },
                post: {
                  select: {
                    id: true,
                    title: true,
                    board: { select: { slug: true, name: true } },
                  },
                },
              },
            },
            message: {
              select: {
                id: true,
                content: true,
                deletedAt: true,
                sender: { select: { id: true, nickname: true } },
              },
            },
          },
        }),
        prisma.adminAuditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            adminId: true,
            action: true,
            targetType: true,
            targetId: true,
            reason: true,
            createdAt: true,
            ipHash: true,
            admin: { select: { nickname: true } },
          },
        }),
        prisma.user.count(),
        prisma.post.count({ where: { status: { not: 'DELETED' } } }),
        prisma.report.count({ where: { status: { in: ['OPEN', 'REVIEWING'] } } }),
        prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
        prisma.post.count({ where: { createdAt: { gte: todayStart }, status: { not: 'DELETED' } } }),
        prisma.comment.count({ where: { createdAt: { gte: todayStart }, status: { not: 'DELETED' } } }),
      ]);
    const activeSessions = await prisma.session.groupBy({
      by: ['userId'],
      where: { scope: 'PORTAL', revokedAt: null, expiresAt: { gt: now } },
      orderBy: { userId: 'asc' },
      _count: { id: true },
    });
    const platform = await getPlatformMode();
    const riro = await getRiroBridgeStatus();
    return json({
      summary: {
        userCount,
        postCount,
        openReportCount,
        newUsersToday,
        todayPosts,
        todayComments,
        activeSessionCount: activeSessions.reduce((sum, entry) => sum + entry._count.id, 0),
        publishedNoticeCount: notices.filter((notice) => notice.status === 'PUBLISHED').length,
        scheduledNoticeCount: notices.filter((notice) => notice.status === 'SCHEDULED').length,
      },
      adminSession: { expiresAt: admin.expiresAt },
      platform: {
        bSideEnabled: platform.bSideEnabled,
        bSideEpoch: platform.bSideEpoch,
        maintenanceEnabled: platform.maintenanceEnabled,
        updatedAt: platform.updatedAt,
      },
      riro,
      posts,
      comments,
      notices,
      reports,
      auditLog,
    });
  } catch (error) {
    return jsonError(error);
  }
}
