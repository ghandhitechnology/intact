import prisma from '@/lib/prisma';
import { json, jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const eligible = { status: 'ACTIVE' as const, studentIdentity: { isNot: null } };
    const [leaders, higherRanked, totalParticipants, teacherLeaders] = await prisma.$transaction([
      prisma.user.findMany({
        where: eligible,
        orderBy: [{ currentIgk: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: 100,
        select: {
          id: true,
          nickname: true, realName: true,
          profileImage: true,
          level: true,
          currentIgk: true,
          lifetimeIgk: true,
          studentIdentity: { select: { studentCode: true } },
        },
      }),
      prisma.user.count({
        where: { ...eligible, currentIgk: { gt: session.user.currentIgk } },
      }),
      prisma.user.count({ where: eligible }),
      prisma.user.findMany({
        where: { ...eligible, level: 10 },
        orderBy: [{ currentIgk: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: 10,
        select: {
          id: true,
          nickname: true, realName: true,
          profileImage: true,
          level: true,
          currentIgk: true,
          lifetimeIgk: true,
          studentIdentity: { select: { studentCode: true } },
        },
      }),
    ]);
    const teacherRankById = new Map(teacherLeaders.map((user, index) => [user.id, index + 1]));
    let previousScore: number | null = null;
    let previousRank = 0;
    return json({
      leaders: leaders.map((user, index) => {
        if (user.currentIgk !== previousScore) {
          previousScore = user.currentIgk;
          previousRank = index + 1;
        }
        return { ...user, rank: previousRank, teacherRank: teacherRankById.get(user.id) ?? null };
      }),
      teacherLeaders: teacherLeaders.map((user, index) => ({ ...user, teacherRank: index + 1 })),
      currentUserTeacherRank: teacherRankById.get(session.user.id) ?? null,
      currentUserRank: session.user.studentIdentity ? higherRanked + 1 : null,
      totalParticipants,
    });
  } catch (error) {
    return jsonError(error);
  }
}
