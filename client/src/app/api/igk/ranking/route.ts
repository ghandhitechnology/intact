import prisma from '@/lib/prisma';
import { json, jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const eligible = { status: 'ACTIVE' as const, studentIdentity: { isNot: null } };
    const [leaders, higherRanked, totalParticipants] = await prisma.$transaction([
      prisma.user.findMany({
        where: eligible,
        orderBy: [{ lifetimeIgk: 'desc' }, { createdAt: 'asc' }],
        take: 100,
        select: {
          id: true,
          nickname: true, realName: true,
          profileImage: true,
          level: true,
          lifetimeIgk: true,
          studentIdentity: { select: { studentCode: true } },
        },
      }),
      prisma.user.count({
        where: { ...eligible, lifetimeIgk: { gt: session.user.lifetimeIgk } },
      }),
      prisma.user.count({ where: eligible }),
    ]);
    let previousScore: number | null = null;
    let previousRank = 0;
    return json({
      leaders: leaders.map((user, index) => {
        if (user.lifetimeIgk !== previousScore) {
          previousScore = user.lifetimeIgk;
          previousRank = index + 1;
        }
        return { ...user, rank: previousRank };
      }),
      currentUserRank: session.user.studentIdentity ? higherRanked + 1 : null,
      totalParticipants,
    });
  } catch (error) {
    return jsonError(error);
  }
}
