import prisma from '@/lib/prisma';
import { json, jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const [user, rules, higherRanked] = await prisma.$transaction([
      prisma.user.findUniqueOrThrow({
        where: { id: session.user.id },
        select: { currentIgk: true, lifetimeIgk: true, igkDebt: true, level: true },
      }),
      prisma.levelRule.findMany({ orderBy: { level: 'asc' } }),
      prisma.user.count({
        where: { status: 'ACTIVE', lifetimeIgk: { gt: session.user.lifetimeIgk } },
      }),
    ]);
    const nextLevel = rules.find((rule) => rule.minimumLifetimeIgk > user.lifetimeIgk) ?? null;
    return json({
      ...user,
      rank: higherRanked + 1,
      nextLevel,
      progress: nextLevel
        ? Math.min(1, user.lifetimeIgk / nextLevel.minimumLifetimeIgk)
        : 1,
    });
  } catch (error) {
    return jsonError(error);
  }
}
