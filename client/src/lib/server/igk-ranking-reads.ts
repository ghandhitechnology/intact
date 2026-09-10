import prisma from '@/lib/prisma';
import { IGK_RANK_LIMIT } from '@/lib/igk-levels';
import { rankedStudentWhere } from '@/lib/server/igk-standing';

export async function readIgkLeaders() {
  const leaders = await prisma.user.findMany({
    where: rankedStudentWhere,
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
  });
  return leaders.map((user, index) => ({ ...user, rank: index + 1, igkRank: index + 1 }));
}
