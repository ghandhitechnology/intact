import type { PrismaClient } from '@prisma/client';
import { createNotificationWithDelivery } from './notifications';
import { getRiroBridgeStatus } from './riro-status';

const ALERT_TITLE = '리로스쿨 인증 점검이 필요합니다.';
const ALERT_DEDUPE_MS = 6 * 60 * 60 * 1000;

export async function checkRiroBridgeAndAlert(prisma: PrismaClient) {
  const status = await getRiroBridgeStatus();
  if (status.state !== 'degraded') return 0;
  const admins = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'DEVELOPER'] }, status: 'ACTIVE' },
    select: { id: true },
  });
  const since = new Date(Date.now() - ALERT_DEDUPE_MS);
  let created = 0;
  for (const admin of admins) {
    const recent = await prisma.notification.findFirst({
      where: { userId: admin.id, title: ALERT_TITLE, createdAt: { gte: since } },
      select: { id: true },
    });
    if (recent) continue;
    const detail = [status.lastFailureCategory, status.lastFailureReason]
      .filter((value): value is string => Boolean(value))
      .join(' · ');
    await createNotificationWithDelivery(prisma, {
      userId: admin.id,
      type: 'SYSTEM',
      title: ALERT_TITLE,
      body:
        (detail ? detail + ' · ' : '') +
        '마지막 성공 ' +
        (status.lastSuccessAt ?? '없음'),
      href: '/admin',
    });
    created += 1;
  }
  return created;
}
