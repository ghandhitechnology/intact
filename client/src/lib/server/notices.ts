import prisma from '@/lib/prisma';

/**
 * Lightweight scheduler fallback. A dedicated worker can call the same state
 * transition later; guarded updateMany makes fanout exactly-once per notice.
 */
export async function materializeDueNotices(now = new Date()) {
  await prisma.notice.updateMany({
    where: {
      status: { in: ['PUBLISHED', 'SCHEDULED'] },
      expiresAt: { lte: now },
    },
    data: { status: 'EXPIRED' },
  });

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
      await tx.notification.createMany({
        data: recipients.map(({ id }) => ({
          userId: id,
          actorId: candidate.authorId,
          type: 'NOTICE',
          title: candidate.title,
          body: candidate.content.slice(0, 120),
          href: `/notices#notice-${candidate.id}`,
          metadata: { noticeId: candidate.id },
        })),
      });
    });
  }
}
