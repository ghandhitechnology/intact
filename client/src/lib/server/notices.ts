import prisma from '@/lib/prisma';
import { createNotificationsWithDelivery } from './notifications';

/**
 * Materializes notice state from a worker. Request-path execution is disabled by
 * default; NOTICE_REQUEST_SCHEDULER_FALLBACK=true is an explicit compatibility
 * escape hatch for deployments that have not started the outbox worker yet.
 */
export async function materializeDueNotices(
  now = new Date(),
  options: { source?: 'request' | 'worker' } = {},
) {
  const source = options.source ?? 'request';
  if (source === 'request' && process.env.NOTICE_REQUEST_SCHEDULER_FALLBACK !== 'true') {
    return { expired: 0, published: 0, skipped: true };
  }

  const expired = await prisma.notice.updateMany({
    where: {
      status: { in: ['PUBLISHED', 'SCHEDULED'] },
      expiresAt: { lte: now },
    },
    data: { status: 'EXPIRED' },
  });

  let publishedCount = 0;
  const due = await prisma.notice.findMany({
    where: { status: 'SCHEDULED', scheduledFor: { lte: now } },
    orderBy: { scheduledFor: 'asc' },
    take: 50,
  });
  for (const candidate of due) {
    await prisma.$transaction(async (tx) => {
      const published = await tx.notice.updateMany({
        where: {
          id: candidate.id,
          status: 'SCHEDULED',
          scheduledFor: { lte: now },
        },
        data: { status: 'PUBLISHED', publishedAt: candidate.scheduledFor ?? now },
      });
      if (published.count !== 1) return;
      publishedCount += 1;
      const grade = candidate.targetAudience === 'ALL'
        ? null
        : Number.parseInt(candidate.targetAudience, 10);
      const recipients = await tx.user.findMany({
        where: {
          status: 'ACTIVE',
          ...(grade ? { studentIdentity: { grade } } : {}),
        },
        select: { id: true },
      });
      if (!recipients.length) return;
      await createNotificationsWithDelivery(
        tx,
        recipients.map(({ id }) => ({
          userId: id,
          actorId: candidate.authorId,
          type: 'NOTICE',
          title: candidate.title,
          body: candidate.content.slice(0, 120),
          href: `/notices#notice-${candidate.id}`,
          metadata: { noticeId: candidate.id },
        })),
      );
    });
  }
  return { expired: expired.count, published: publishedCount, skipped: false };
}
