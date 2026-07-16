import prisma from '@/lib/prisma';
import { JOJIN_RANK_LIMIT } from '@/lib/igk-levels';
import { json, jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const [user, rules, higherRanked, jojinLeaders] = await prisma.$transaction([
      prisma.user.findUniqueOrThrow({
        where: { id: session.user.id },
        select: { currentIgk: true, lifetimeIgk: true, igkDebt: true, level: true },
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
        take: JOJIN_RANK_LIMIT,
        select: { id: true },
      }),
    ]);
    const jojinRank = jojinLeaders.findIndex((candidate) => candidate.id === session.user.id);
    const currentLevel = [...rules]
      .reverse()
      .find((rule) => rule.minimumLifetimeIgk <= user.lifetimeIgk) ?? rules[0] ?? null;
    const nextLevel = rules.find((rule) => rule.minimumLifetimeIgk > user.lifetimeIgk) ?? null;
    const progressRange = nextLevel && currentLevel
      ? nextLevel.minimumLifetimeIgk - currentLevel.minimumLifetimeIgk
      : 0;
    return json({
      ...user,
      level: currentLevel?.level ?? 1,
      jojinRank: jojinRank >= 0 ? jojinRank + 1 : null,
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
