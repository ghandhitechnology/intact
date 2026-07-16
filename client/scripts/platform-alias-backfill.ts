import { PrismaClient } from '@prisma/client';
import { materializePlatformAliases } from '../src/lib/server/platform-mode';

const prisma = new PrismaClient();
const batchSize = Math.max(10, Math.min(2_000, Number(process.env.PLATFORM_ALIAS_BATCH_SIZE || 500)));

async function main() {
  const mode = await prisma.platformSetting.findUnique({
    where: { id: 'global' },
    select: { bSideEnabled: true, bSideEpoch: true },
  });
  if (!mode?.bSideEnabled) {
    console.info(JSON.stringify({ event: 'platform_alias.backfill_skipped', reason: 'b_side_disabled' }));
    return;
  }

  let inserted = 0;
  while (true) {
    const missing = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        platformAliases: { none: { epoch: mode.bSideEpoch } },
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true },
    });
    if (!missing.length) break;

    const ids = missing.map(({ id }) => id);
    const result = await materializePlatformAliases(prisma, mode.bSideEpoch, ids);
    inserted += result.count;
    if (result.count < ids.length) {
      const unresolved = await prisma.user.count({
        where: {
          id: { in: ids },
          status: 'ACTIVE',
          platformAliases: { none: { epoch: mode.bSideEpoch } },
        },
      });
      if (unresolved > 0) {
        throw new Error(`Could not materialize ${unresolved} platform alias(es); check for alias collisions.`);
      }
    }
  }

  const activeUsers = await prisma.user.count({ where: { status: 'ACTIVE' } });
  const aliases = await prisma.platformAlias.count({ where: { epoch: mode.bSideEpoch } });
  console.info(JSON.stringify({
    event: 'platform_alias.backfill_completed',
    epoch: mode.bSideEpoch,
    inserted,
    activeUsers,
    aliases,
  }));
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: 'platform_alias.backfill_failed', error: message.slice(0, 500) }));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
