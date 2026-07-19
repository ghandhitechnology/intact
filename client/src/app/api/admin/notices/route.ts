import prisma from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/server/audit';
import {
  ApiError,
  assertSameOrigin,
  json,
  jsonError,
  readJson,
  requiredInteger,
  requiredString,
} from '@/lib/server/http';
import { requireReadyAdmin } from '@/lib/server/session';
import { createNotificationsWithDelivery } from '@/lib/server/notifications';

export const runtime = 'nodejs';

interface NoticeBody {
  title?: unknown;
  content?: unknown;
  status?: unknown;
  priority?: unknown;
  targetAudience?: unknown;
  scheduledFor?: unknown;
  expiresAt?: unknown;
  reason?: unknown;
}

function optionalDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new ApiError(400, 'INVALID_DATE', `${field} 날짜가 올바르지 않습니다.`);
  return date;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireReadyAdmin(request);
    const body = await readJson<NoticeBody>(request, 128 * 1024);
    const title = requiredString(body.title, '공지 제목', { min: 2, max: 180 });
    const content = requiredString(body.content, '공지 내용', { min: 1, max: 50_000, trim: false }).trim();
    const reason = requiredString(body.reason, '등록 사유', { min: 2, max: 1_000 });
    const allowedStatuses = ['DRAFT', 'SCHEDULED', 'PUBLISHED'] as const;
    const status = allowedStatuses.includes(body.status as (typeof allowedStatuses)[number])
      ? (body.status as (typeof allowedStatuses)[number])
      : 'DRAFT';
    const scheduledFor = optionalDate(body.scheduledFor, '예약 게시');
    const expiresAt = optionalDate(body.expiresAt, '만료');
    if (status === 'SCHEDULED' && (!scheduledFor || scheduledFor <= new Date())) {
      throw new ApiError(400, 'INVALID_SCHEDULE', '예약 공지는 현재보다 뒤의 게시 시간이 필요합니다.');
    }
    const priority = requiredInteger(body.priority ?? 0, '우선순위', -100, 100);
    const allowedAudiences = ['ALL', '1학년', '2학년', '3학년'] as const;
    const requestedAudience = typeof body.targetAudience === 'string' ? body.targetAudience.trim() : 'ALL';
    if (!allowedAudiences.includes(requestedAudience as (typeof allowedAudiences)[number])) {
      throw new ApiError(400, 'INVALID_AUDIENCE', '공지 노출 대상이 올바르지 않습니다.');
    }
    const targetAudience = requestedAudience as (typeof allowedAudiences)[number];
    const notice = await prisma.$transaction(async (tx) => {
      const created = await tx.notice.create({
        data: {
          authorId: admin.user.id,
          title,
          content,
          status,
          priority,
          targetAudience,
          scheduledFor,
          expiresAt,
          publishedAt: status === 'PUBLISHED' ? new Date() : null,
        },
      });
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id,
        action: 'NOTICE_CREATE',
        targetType: 'NOTICE',
        targetId: created.id,
        reason,
        after: created,
      });
      if (status === 'PUBLISHED') {
        const grade = targetAudience === 'ALL' ? null : Number.parseInt(targetAudience, 10);
        const recipients = await tx.user.findMany({
          where: {
            status: 'ACTIVE',
            ...(grade ? { studentIdentity: { grade } } : {}),
          },
          select: { id: true },
        });
        await createNotificationsWithDelivery(
          tx,
          recipients.map(({ id }) => ({
            userId: id,
            actorId: admin.user.id,
            type: 'NOTICE',
            title,
            body: content.slice(0, 120),
            href: `/notices#notice-${created.id}`,
            metadata: { noticeId: created.id },
          })),
        );
      }
      return created;
    });
    return json({ notice }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
