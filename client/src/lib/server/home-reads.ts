import prisma from '@/lib/prisma';
import { readBoardOverview } from '@/lib/server/board-reads';
import { readIgkLeaders } from '@/lib/server/igk-ranking-reads';
import { topIgkRankMap } from '@/lib/server/igk-standing';
import { readVisibleNotices } from '@/lib/server/notice-reads';
import { maskPublicIdentities } from '@/lib/server/platform-mode';
import type { HomeLoaders } from '@/lib/server/home-service';
import type { requireUser } from '@/lib/server/session';

type PortalSession = Awaited<ReturnType<typeof requireUser>>;

// 인증을 마친 요청의 사용자만 전달하며, 조회 결과는 요청 사이에 보관하지 않습니다.
export function createHomeLoaders({ user }: PortalSession): HomeLoaders {
  return {
    boards: () => readBoardOverview(user.id),
    notices: () => readVisibleNotices(user.id, user.studentIdentity?.grade),
    leaders: async () => ({
      leaders: await maskPublicIdentities(await readIgkLeaders(), user.id),
    }),
    notifications: async () => ({
      unreadCount: await prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    }),
    balance: async () => ({
      currentIgk: user.currentIgk,
      igkRank: (await topIgkRankMap()).get(user.id) ?? null,
    }),
  };
}
