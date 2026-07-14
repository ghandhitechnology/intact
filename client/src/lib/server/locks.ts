import type { Prisma } from '@prisma/client';

/** Transaction-scoped logical locks for cross-table invariants. */
export async function lockResources(tx: Prisma.TransactionClient, resourceKeys: string[]) {
  const ordered = Array.from(new Set(resourceKeys)).sort();
  for (const resourceKey of ordered) {
    // The PostgreSQL function returns `void`; execute it without asking Prisma
    // to deserialize a result row.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${resourceKey}),
        hashtext('portal-resource')
      )
    `;
  }
}
