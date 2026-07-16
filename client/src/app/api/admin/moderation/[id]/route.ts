import { Prisma, type SanctionType } from '@prisma/client';
import prisma from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/server/audit';
import { awardIgk, reverseReward } from '@/lib/server/igk';
import { ApiError, assertSameOrigin, json, jsonError, readJson, requiredString } from '@/lib/server/http';
import { requireReadyAdmin } from '@/lib/server/session';

export const runtime = 'nodejs';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireReadyAdmin(request);
    const { id } = await context.params;
    const body = await readJson<{ action?: unknown; reason?: unknown; sanctionType?: unknown; days?: unknown }>(request);
    const actions = ['APPROVE', 'REJECT', 'HIDE', 'RETRY', 'SANCTION'] as const;
    if (!actions.includes(body.action as (typeof actions)[number])) {
      throw new ApiError(400, 'INVALID_ACTION', '지원하지 않는 이중망 처리 작업입니다.');
    }
    const action = body.action as (typeof actions)[number];
    const reason = requiredString(body.reason, '처리 사유', { min: 2, max: 1000 });
    const before = await prisma.moderationSubmission.findUnique({ where: { id }, include: { post: true } });
    if (!before) throw new ApiError(404, 'MODERATION_NOT_FOUND', '심사 건을 찾을 수 없습니다.');

    const result = await prisma.$transaction(async (tx) => {
      let submission = before;
      if (action === 'APPROVE') {
        const post = await tx.post.findUniqueOrThrow({ where: { id: before.postId } });
        const stagedAttachments = await tx.attachment.count({
          where: {
            id: { in: before.candidateAttachmentIds }, uploaderId: before.authorId, messageId: null,
            OR: [{ postId: null }, { postId: post.id }],
          },
        });
        if (stagedAttachments !== before.candidateAttachmentIds.length) {
          throw new ApiError(409, 'STAGED_ATTACHMENT_CHANGED', '심사 중 첨부 파일이 변경되었습니다. 재검사해 주세요.');
        }
        if (!before.isNewPost && (post.title !== before.candidateTitle || post.content !== before.candidateContent)) {
          await tx.postRevision.create({ data: { postId: post.id, editorId: before.authorId, title: post.title, content: post.content, reason } });
        }
        await tx.attachment.updateMany({
          where: { id: { in: before.candidateAttachmentIds }, uploaderId: before.authorId, postId: null, messageId: null },
          data: { postId: post.id },
        });
        await tx.post.update({
          where: { id: post.id },
          data: {
            title: before.candidateTitle, content: before.candidateContent, contentText: before.candidateContentText,
            tags: before.candidateTags, metadata: before.candidateMetadata === null ? Prisma.JsonNull : before.candidateMetadata,
            boardId: before.candidateBoardId, kind: before.candidateKind, status: 'PUBLISHED',
            publishedAt: post.publishedAt ?? new Date(), editedAt: before.isNewPost ? post.editedAt : new Date(),
          },
        });
        await awardIgk(tx, {
          userId: before.authorId, amount: 10, type: 'POST_CREATED', idempotencyKey: `post:create:${post.id}`,
          sourceType: 'POST', sourceId: post.id, dailyCap: 100, note: '운영자 이중망 승인 게시글 작성 보상',
        });
        submission = await tx.moderationSubmission.update({
          where: { id }, data: { state: 'ALLOWED', decision: 'ALLOW', reviewedById: admin.user.id, reviewedAt: new Date(), reviewerReason: reason, completedAt: new Date() },
          include: { post: true },
        });
      } else if (action === 'REJECT') {
        if (before.isNewPost) await tx.post.update({ where: { id: before.postId }, data: { status: 'HIDDEN' } });
        submission = await tx.moderationSubmission.update({
          where: { id }, data: { state: 'BLOCKED', decision: 'BLOCK', reviewedById: admin.user.id, reviewedAt: new Date(), reviewerReason: reason, completedAt: new Date() },
          include: { post: true },
        });
      } else if (action === 'HIDE') {
        await tx.post.update({ where: { id: before.postId }, data: { status: 'HIDDEN' } });
        await reverseReward(tx, {
          userId: before.authorId, originalIdempotencyKey: `post:create:${before.postId}`,
          idempotencyKey: `post:moderation-hide:${before.postId}`, sourceType: 'POST', sourceId: before.postId, note: '이중망 운영자 숨김 보상 회수',
        });
      } else if (action === 'RETRY') {
        submission = await tx.moderationSubmission.update({
          where: { id }, data: { state: 'QUEUED', decision: null, attemptCount: 0, claimedAt: null, leaseExpiresAt: null, completedAt: null, reviewerReason: reason },
          include: { post: true },
        });
      } else {
        const sanctionTypes: SanctionType[] = ['WARNING', 'TEMPORARY_SUSPENSION', 'PERMANENT_BAN'];
        const sanctionType = sanctionTypes.includes(body.sanctionType as SanctionType) ? body.sanctionType as SanctionType : 'WARNING';
        const days = Math.max(1, Math.min(365, Number(body.days) || 7));
        await tx.sanction.create({
          data: {
            targetUserId: before.authorId, issuedById: admin.user.id, type: sanctionType, reason,
            endsAt: sanctionType === 'TEMPORARY_SUSPENSION' ? new Date(Date.now() + days * 86_400_000) : null,
          },
        });
        if (sanctionType !== 'WARNING') {
          await tx.user.update({ where: { id: before.authorId }, data: { status: 'SUSPENDED' } });
        }
      }
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id, action: `MODERATION_${action}`, targetType: 'MODERATION_SUBMISSION', targetId: before.id,
        reason, before, after: submission,
      });
      return submission;
    });
    return json({ submission: result });
  } catch (error) {
    return jsonError(error);
  }
}
