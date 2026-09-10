import prisma from '@/lib/prisma';
import { materializeDueNotices } from '@/lib/server/notices';
import { maskPublicIdentities } from '@/lib/server/platform-mode';

export async function readVisibleNotices(viewerId: string, grade: number | null | undefined, limit = 10) {
  const now = new Date();
  await materializeDueNotices(now);
  const notices = await prisma.notice.findMany({
    where: {
      AND: [
        {
          targetAudience: {
            in: [
              'ALL',
              ...(grade
                ? [`${grade}학년`]
                : []),
            ],
          },
        },
        {
          OR: [
            {
              status: 'PUBLISHED',
              OR: [{ publishedAt: null }, { publishedAt: { lte: now } }],
            },
            { status: 'SCHEDULED', scheduledFor: { lte: now } },
          ],
        },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      ],
    },
    orderBy: [{ priority: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: {
      author: {
        select: { id: true, nickname: true, realName: true, role: true, profileImage: true },
      },
    },
  });
  return { notices: await maskPublicIdentities(notices, viewerId) };
}
