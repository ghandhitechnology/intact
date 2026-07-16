import type { SanctionType } from '@prisma/client';
import prisma from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/server/audit';
import { awardIgk, reverseReward } from '@/lib/server/igk';
import { ApiError, assertSameOrigin, json, jsonError, readJson, requiredString } from '@/lib/server/http';
import {
  applyApprovedModerationCandidate,
  moderationBaseMatchesPost,
  validateModerationCandidateForApproval,
} from '@/lib/server/moderation';
import {
  canAdminModerationAction,
  compareAndSwapModerationState,
  isLatestModerationSubmission,
  lockModerationPostAndSubmission,
} from '@/lib/server/moderation-state';
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

    const result = await prisma.$transaction(async (tx) => {
      const control = await lockModerationPostAndSubmission(tx, id);
      if (!control) throw new ApiError(404, 'MODERATION_NOT_FOUND', '심사 건을 찾을 수 없습니다.');
      const before = await tx.moderationSubmission.findUnique({ where: { id }, include: { post: true } });
      if (!before) throw new ApiError(404, 'MODERATION_NOT_FOUND', '심사 건을 찾을 수 없습니다.');
      let submission = before;

      if (action === 'APPROVE' || action === 'REJECT' || action === 'RETRY') {
        if (!await isLatestModerationSubmission(tx, control)) {
          throw new ApiError(409, 'MODERATION_NOT_LATEST', '더 최신 심사 건이 있어 이 작업을 처리할 수 없습니다.');
        }
        if (!canAdminModerationAction(control.state, action)) {
          throw new ApiError(409, 'INVALID_MODERATION_STATE', '현재 심사 상태에서는 이 작업을 처리할 수 없습니다.');
        }
        if (!moderationBaseMatchesPost(before, before.post)) {
          throw new ApiError(409, 'POST_VERSION_CONFLICT', '심사 중 게시물이 변경되었습니다. 최신 내용으로 다시 검사해 주세요.');
        }
      }

      if (action === 'APPROVE') {
        const validation = await validateModerationCandidateForApproval(tx, before, before.post);
        if (!validation.ok) {
          throw new ApiError(409, validation.conflict, '심사 중 첨부 파일이 변경되었습니다. 재검사해 주세요.');
        }
        const transitioned = await compareAndSwapModerationState(tx, id, control, 'ALLOWED', 'ADMIN_REVIEW');
        if (transitioned === null) {
          throw new ApiError(409, 'MODERATION_STATE_CONFLICT', '심사 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
        }
        const approval = await applyApprovedModerationCandidate(tx, before, before.post, {
          revisionReason: reason,
        });
        if (!approval.ok) {
          throw new ApiError(409, approval.conflict, '심사 대상이 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
        }
        await awardIgk(tx, {
          userId: before.authorId,
          amount: 10,
          type: 'POST_CREATED',
          idempotencyKey: `post:create:${before.postId}`,
          sourceType: 'POST',
          sourceId: before.postId,
          dailyCap: 100,
          note: '운영자 이중망 승인 게시글 작성 보상',
        });
        submission = await tx.moderationSubmission.update({
          where: { id },
          data: {
            decision: 'ALLOW',
            reviewedById: admin.user.id,
            reviewedAt: new Date(),
            reviewerReason: reason,
          },
          include: { post: true },
        });
      } else if (action === 'REJECT') {
        const transitioned = await compareAndSwapModerationState(tx, id, control, 'BLOCKED', 'ADMIN_REVIEW');
        if (transitioned === null) {
          throw new ApiError(409, 'MODERATION_STATE_CONFLICT', '심사 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
        }
        if (before.isNewPost) {
          await tx.post.update({
            where: { id: before.postId },
            data: { status: 'HIDDEN', version: { increment: 1 } },
          });
        }
        submission = await tx.moderationSubmission.update({
          where: { id },
          data: {
            decision: 'BLOCK',
            reviewedById: admin.user.id,
            reviewedAt: new Date(),
            reviewerReason: reason,
          },
          include: { post: true },
        });
      } else if (action === 'HIDE') {
        await tx.post.update({
          where: { id: before.postId },
          data: { status: 'HIDDEN', version: { increment: 1 } },
        });
        await reverseReward(tx, {
          userId: before.authorId,
          originalIdempotencyKey: `post:create:${before.postId}`,
          idempotencyKey: `post:moderation-hide:${before.postId}`,
          sourceType: 'POST',
          sourceId: before.postId,
          note: '이중망 운영자 숨김 보상 회수',
        });
        submission = await tx.moderationSubmission.findUniqueOrThrow({ where: { id }, include: { post: true } });
      } else if (action === 'RETRY') {
        const validation = await validateModerationCandidateForApproval(tx, before, before.post);
        if (!validation.ok) {
          throw new ApiError(409, validation.conflict, '심사 중 첨부 파일이 변경되었습니다. 최신 내용으로 다시 검사해 주세요.');
        }
        const transitioned = await compareAndSwapModerationState(tx, id, control, 'QUEUED', 'ADMIN_RETRY');
        if (transitioned === null) {
          throw new ApiError(409, 'MODERATION_STATE_CONFLICT', '심사 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
        }
        submission = await tx.moderationSubmission.update({
          where: { id },
          data: {
            decision: null,
            attemptCount: 0,
            reviewedById: admin.user.id,
            reviewedAt: new Date(),
            reviewerReason: reason,
          },
          include: { post: true },
        });
      } else {
        const sanctionTypes: SanctionType[] = ['WARNING', 'TEMPORARY_SUSPENSION', 'PERMANENT_BAN'];
        const sanctionType = sanctionTypes.includes(body.sanctionType as SanctionType)
          ? body.sanctionType as SanctionType
          : 'WARNING';
        const days = Math.max(1, Math.min(365, Number(body.days) || 7));
        await tx.sanction.create({
          data: {
            targetUserId: before.authorId,
            issuedById: admin.user.id,
            type: sanctionType,
            reason,
            endsAt: sanctionType === 'TEMPORARY_SUSPENSION'
              ? new Date(Date.now() + days * 86_400_000)
              : null,
          },
        });
        if (sanctionType !== 'WARNING') {
          await tx.user.update({ where: { id: before.authorId }, data: { status: 'SUSPENDED' } });
        }
      }
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id,
        action: `MODERATION_${action}`,
        targetType: 'MODERATION_SUBMISSION',
        targetId: before.id,
        reason,
        before,
        after: submission,
      });
      return submission;
    });
    return json({ submission: result });
  } catch (error) {
    return jsonError(error);
  }
}
