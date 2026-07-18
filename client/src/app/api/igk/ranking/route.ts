import prisma from '@/lib/prisma';
import { IGK_RANK_LIMIT } from '@/lib/igk-levels';
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
      prisma.user.findMany({
        where: eligible,
        orderBy: [{ currentIgk: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: IGK_RANK_LIMIT,
        select: {
          id: true,
          nickname: true,
          realName: true,
          profileImage: true,
          profileImageAttachmentId: true,
          level: true,
          currentIgk: true,
          lifetimeIgk: true,
          studentIdentity: { select: { studentCode: true } },
        },
      }),
      prisma.user.count({ where: eligible }),
      overallIgkRank(session.user.id),
    ]);
    return json(await maskPublicIdentities({
      leaders: leaders.map((user, index) => ({
        ...user,
        rank: index + 1,
        igkRank: index + 1,
      })),
      currentUserRank,
      totalParticipants,
    }, session.user.id));
  } catch (error) {
    return jsonError(error);
  }
}
