import prisma from '@/lib/prisma';
import { readIgkLeaders } from '@/lib/server/igk-ranking-reads';
import { json, jsonError } from '@/lib/server/http';
import { overallIgkRank } from '@/lib/server/igk-standing';
import { requireUser } from '@/lib/server/session';
import { maskPublicIdentities } from '@/lib/server/platform-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const eligible = { status: 'ACTIVE' as const, studentIdentity: { isNot: null } };
    const [leaders, totalParticipants, currentUserRank] = await Promise.all([
      readIgkLeaders(),
      prisma.user.count({ where: eligible }),
      overallIgkRank(session.user.id),
    ]);
    return json(await maskPublicIdentities({
      leaders,
      currentUserRank,
      totalParticipants,
    }, session.user.id));
  } catch (error) {
    return jsonError(error);
  }
}
