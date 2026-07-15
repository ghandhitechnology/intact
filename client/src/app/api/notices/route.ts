import prisma from '@/lib/prisma';
import { json, jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';
import { materializeDueNotices } from '@/lib/server/notices';
import { maskPublicIdentities } from '@/lib/server/platform-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const url = new URL(request.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 10) || 10));
    const now = new Date();
    await materializeDueNotices(now);
    const notices = await prisma.notice.findMany({
      where: {
        AND: [
          {
            targetAudience: {
              in: [
                'ALL',
                ...(session.user.studentIdentity?.grade
                  ? [`${session.user.studentIdentity.grade}학년`]
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
    return json({ notices: await maskPublicIdentities(notices, session.user.id) });
  } catch (error) {
    return jsonError(error);
  }
}
