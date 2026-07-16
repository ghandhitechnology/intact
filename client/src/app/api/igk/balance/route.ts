import prisma from '@/lib/prisma';
import { JOJOL_RANK_LIMIT } from '@/lib/igk-levels';
import { seoulCalendarDate } from '@/lib/server/igk';
import { json, jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const [user, rules, higherRanked, jojolLeaders] = await prisma.$transaction([
      prisma.user.findUniqueOrThrow({
        where: { id: session.user.id },
        select: {
          currentIgk: true,
          lifetimeIgk: true,
          igkDebt: true,
          level: true,
          attendanceStreak: true,
          bestAttendanceStreak: true,
          lastAttendanceDate: true,
        },
      }),
      prisma.levelRule.findMany({ orderBy: { level: 'asc' } }),
      prisma.user.count({
        where: {
          status: 'ACTIVE',
          studentIdentity: { isNot: null },
          currentIgk: { gt: session.user.currentIgk },
        },
      }),
      prisma.user.findMany({
        where: { status: 'ACTIVE', level: 10, studentIdentity: { isNot: null } },
        orderBy: [{ currentIgk: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: JOJOL_RANK_LIMIT,
        select: { id: true },
      }),
    ]);
    const jojolRank = jojolLeaders.findIndex((candidate) => candidate.id === session.user.id);
    const currentLevel = [...rules]
      .reverse()
      .find((rule) => rule.minimumLifetimeIgk <= user.lifetimeIgk) ?? rules[0] ?? null;
    const nextLevel = rules.find((rule) => rule.minimumLifetimeIgk > user.lifetimeIgk) ?? null;
    const progressRange = nextLevel && currentLevel
      ? nextLevel.minimumLifetimeIgk - currentLevel.minimumLifetimeIgk
      : 0;
    const { lastAttendanceDate, ...walletUser } = user;
    return json({
      ...walletUser,
      attendanceClaimedToday:
        lastAttendanceDate?.getTime() === seoulCalendarDate().getTime(),
      level: currentLevel?.level ?? 1,
      jojolRank: jojolRank >= 0 ? jojolRank + 1 : null,
      rank: higherRanked + 1,
      currentLevel,
      nextLevel,
      progress: nextLevel
        ? Math.min(
            1,
            Math.max(0, (user.lifetimeIgk - (currentLevel?.minimumLifetimeIgk ?? 0)) / Math.max(1, progressRange)),
          )
        : 1,
    });
  } catch (error) {
    return jsonError(error);
  }
}
