import type { Prisma } from '@prisma/client';
import { igkStanding, type IgkStanding } from '@/lib/igk-levels';
import prisma from '@/lib/prisma';

type RankClient = Pick<Prisma.TransactionClient, 'user' | '$queryRaw'>;

export const rankedStudentWhere = {
  status: 'ACTIVE' as const,
  studentIdentity: { isNot: null },
};

export async function topIgkRankMap(client: RankClient = prisma) {
  const leaders = await client.user.findMany({
    where: rankedStudentWhere,
    orderBy: [{ currentIgk: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: 10,
    select: { id: true },
  });
  return new Map(leaders.map((leader, index) => [leader.id, index + 1]));
}

export async function overallIgkRank(userId: string, client: RankClient = prisma) {
  const rows = await client.$queryRaw<Array<{ position: bigint }>>`
    WITH ranked AS (
      SELECT users."id",
             row_number() OVER (
               ORDER BY users."currentIgk" DESC, users."createdAt" ASC, users."id" ASC
             ) AS position
      FROM "User" AS users
      WHERE users."status" = 'ACTIVE'
        AND EXISTS (
          SELECT 1 FROM "StudentIdentity" AS identities
          WHERE identities."userId" = users."id"
        )
    )
    SELECT position FROM ranked WHERE "id" = ${userId}::uuid
  `;
  return rows[0] ? Number(rows[0].position) : null;
}

function collectStandingUsers(value: unknown, users: Map<string, number>) {
  if (Array.isArray(value)) {
    for (const item of value) collectStandingUsers(item, users);
    return;
  }
  if (!value || typeof value !== 'object' || value instanceof Date) return;
  const source = value as Record<string, unknown>;
  if (typeof source.id === 'string' && typeof source.level === 'number') {
    users.set(source.id, source.level);
  }
  for (const nested of Object.values(source)) collectStandingUsers(nested, users);
}

function applyStandingTree(
  value: unknown,
  levels: ReadonlyMap<string, number>,
  ranks: ReadonlyMap<string, number>,
): unknown {
  if (Array.isArray(value)) return value.map((item) => applyStandingTree(item, levels, ranks));
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(source)) {
    if (key === 'profileImageAttachmentId') continue;
    result[key] = applyStandingTree(nested, levels, ranks);
  }
  if (typeof source.profileImageAttachmentId === 'string') {
    result.profileImage = `/api/uploads/${encodeURIComponent(source.profileImageAttachmentId)}?variant=avatar`;
  }
  if (typeof source.id === 'string' && levels.has(source.id)) {
    result.standing = igkStanding(levels.get(source.id)!, ranks.get(source.id) ?? null);
    result.igkRank = ranks.get(source.id) ?? null;
  }
  return result;
}

export async function enrichPublicUserTree<T>(value: T): Promise<T> {
  const levels = new Map<string, number>();
  collectStandingUsers(value, levels);
  if (levels.size === 0) return value;
  const ranks = await topIgkRankMap();
  return applyStandingTree(value, levels, ranks) as T;
}

export function standingFor(level: number, rank?: number | null): IgkStanding {
  return igkStanding(level, rank);
}
