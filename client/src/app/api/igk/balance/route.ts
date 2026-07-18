import prisma from '@/lib/prisma';
import { igkStanding } from '@/lib/igk-levels';
import { seoulCalendarDate } from '@/lib/server/igk';
import { json, jsonError } from '@/lib/server/http';
import { overallIgkRank, topIgkRankMap } from '@/lib/server/igk-standing';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const [user, rules, rankMap, rank] = await Promise.all([
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
      topIgkRankMap(),
      overallIgkRank(session.user.id),
    ]);
    const igkRank = rankMap.get(session.user.id) ?? null;
    const currentLevel = [...rules]
      .reverse()
      .find((rule) => rule.minimumCurrentIgk <= user.currentIgk) ?? rules[0] ?? null;
    const nextLevel = rules.find((rule) => rule.minimumCurrentIgk > user.currentIgk) ?? null;
    const progressRange = nextLevel && currentLevel
      ? nextLevel.minimumCurrentIgk - currentLevel.minimumCurrentIgk
      : 0;
    const { lastAttendanceDate, ...walletUser } = user;
    const level = currentLevel?.level ?? 1;
    return json({
      ...walletUser,
      attendanceClaimedToday:
        lastAttendanceDate?.getTime() === seoulCalendarDate().getTime(),
      level,
      igkRank,
      standing: igkStanding(level, igkRank),
      rank,
      currentLevel,
      nextLevel,
      progress: nextLevel
        ? Math.min(
            1,
            Math.max(
              0,
              (user.currentIgk - (currentLevel?.minimumCurrentIgk ?? 0))
                / Math.max(1, progressRange),
            ),
          )
        : 1,
    });
  } catch (error) {
    return jsonError(error);
  }
}
