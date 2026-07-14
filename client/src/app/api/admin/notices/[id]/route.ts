import prisma from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/server/audit';
import { ApiError, assertSameOrigin, json, jsonError, readJson, requiredString } from '@/lib/server/http';
import { requireReadyAdmin } from '@/lib/server/session';

export const runtime = 'nodejs';

function optionalDate(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, 'INVALID_DATE', `${field} 날짜가 올바르지 않습니다.`);
  }
  return date;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    assertSameOrigin(request);
    const admin = await requireReadyAdmin(request);
    const body = await readJson<Record<string, unknown>>(request, 128 * 1024);
    const reason = requiredString(body.reason, '처리 사유', { min: 2, max: 1_000 });
    const before = await prisma.notice.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, 'NOTICE_NOT_FOUND', '공지를 찾을 수 없습니다.');
    const allowedStatuses = ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'EXPIRED', 'DELETED'] as const;
    const status = allowedStatuses.includes(body.status as (typeof allowedStatuses)[number])
      ? (body.status as (typeof allowedStatuses)[number])
      : before.status;
    const title = body.title === undefined
      ? before.title
      : requiredString(body.title, '공지 제목', { min: 2, max: 180 });
    const content = body.content === undefined
      ? before.content
      : requiredString(body.content, '공지 내용', { min: 1, max: 50_000, trim: false }).trim();
    const scheduledFor = optionalDate(body.scheduledFor, '예약 게시');
    const expiresAt = optionalDate(body.expiresAt, '만료');
    const effectiveScheduledFor = scheduledFor === undefined ? before.scheduledFor : scheduledFor;
    if (status === 'SCHEDULED' && (!effectiveScheduledFor || effectiveScheduledFor <= new Date())) {
      throw new ApiError(400, 'INVALID_SCHEDULE', '예약 공지는 현재보다 뒤의 게시 시간이 필요합니다.');
    }
    const allowedAudiences = ['ALL', '1학년', '2학년', '3학년'] as const;
    const requestedAudience = body.targetAudience === undefined
      ? before.targetAudience
      : typeof body.targetAudience === 'string'
        ? body.targetAudience.trim()
        : '';
    if (!allowedAudiences.includes(requestedAudience as (typeof allowedAudiences)[number])) {
      throw new ApiError(400, 'INVALID_AUDIENCE', '공지 노출 대상이 올바르지 않습니다.');
    }
    const targetAudience = requestedAudience as (typeof allowedAudiences)[number];
    const notice = await prisma.$transaction(async (tx) => {
      const updated = await tx.notice.update({
        where: { id: before.id },
        data: {
          title,
          content,
          status,
          priority:
            typeof body.priority === 'number'
              ? Math.max(-100, Math.min(100, Math.trunc(body.priority)))
              : before.priority,
          targetAudience,
          scheduledFor: status === 'SCHEDULED' ? effectiveScheduledFor : null,
          publishedAt:
            status === 'PUBLISHED' && before.status !== 'PUBLISHED'
              ? new Date()
              : before.publishedAt,
          expiresAt: expiresAt === undefined ? before.expiresAt : expiresAt,
        },
      });
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id,
        action: 'NOTICE_UPDATE',
        targetType: 'NOTICE',
        targetId: before.id,
        reason,
        before,
        after: updated,
      });
      if (status === 'PUBLISHED' && before.status !== 'PUBLISHED') {
        const grade = targetAudience === 'ALL' ? null : Number.parseInt(targetAudience, 10);
        const recipients = await tx.user.findMany({
          where: {
            status: 'ACTIVE',
            ...(grade ? { studentIdentity: { grade } } : {}),
          },
          select: { id: true },
        });
        await tx.notification.createMany({
          data: recipients.map(({ id: userId }) => ({
            userId,
            actorId: admin.user.id,
            type: 'NOTICE',
            title,
            body: content.slice(0, 120),
            href: `/notices#notice-${updated.id}`,
            metadata: { noticeId: updated.id },
          })),
        });
      }
      return updated;
    });
    return json({ notice });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    assertSameOrigin(request);
    const admin = await requireReadyAdmin(request);
    const body = await readJson<{ reason?: unknown }>(request);
    const reason = requiredString(body.reason, '삭제 사유', { min: 2, max: 1_000 });
    const before = await prisma.notice.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, 'NOTICE_NOT_FOUND', '공지를 찾을 수 없습니다.');
    const notice = await prisma.$transaction(async (tx) => {
      const updated = await tx.notice.update({ where: { id: before.id }, data: { status: 'DELETED' } });
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id,
        action: 'NOTICE_DELETE',
        targetType: 'NOTICE',
        targetId: before.id,
        reason,
        before,
        after: updated,
      });
      return updated;
    });
    return json({ notice });
  } catch (error) {
    return jsonError(error);
  }
}
