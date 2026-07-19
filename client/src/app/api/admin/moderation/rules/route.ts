import { type ModerationRuleKind } from '@prisma/client';
import prisma from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/server/audit';
import { ApiError, assertSameOrigin, json, jsonError, readJson, requiredString } from '@/lib/server/http';
import { normalizeForModeration } from '@/lib/server/moderation';
import { requireReadyAdmin } from '@/lib/server/session';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireReadyAdmin(request);
    const body = await readJson<{ kind?: unknown; pattern?: unknown; severity?: unknown; notes?: unknown }>(request);
    const kinds: ModerationRuleKind[] = ['TERM', 'REGEX', 'ALLOWLIST', 'TARGET_ALIAS', 'IMAGE_HASH'];
    if (!kinds.includes(body.kind as ModerationRuleKind)) throw new ApiError(400, 'INVALID_RULE_KIND', '규칙 종류가 올바르지 않습니다.');
    const kind = body.kind as ModerationRuleKind;
    const pattern = requiredString(body.pattern, '규칙 패턴', { min: 1, max: 500, trim: false });
    const normalized = (kind === 'REGEX'
      ? pattern
      : kind === 'IMAGE_HASH'
        ? pattern.toLowerCase().replace(/\s+/g, '')
        : normalizeForModeration(pattern).split('\n')[1] ?? pattern).slice(0, 500);
    if (kind === 'REGEX') {
      try { new RegExp(pattern, 'iu'); } catch { throw new ApiError(400, 'INVALID_REGEX', '정규식이 올바르지 않습니다.'); }
    }
    if (kind === 'IMAGE_HASH' && !/^[0-9a-f]{16}$/.test(normalized)) {
      throw new ApiError(400, 'INVALID_IMAGE_HASH', '이미지 pHash는 16자리 16진수여야 합니다.');
    }
    const severity = Math.max(0, Math.min(100, Number(body.severity) || 50));
    const rule = await prisma.$transaction(async (tx) => {
      const created = await tx.moderationRule.create({
        data: {
          kind, pattern, normalized, severity, enabled: false,
          notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : null, createdById: admin.user.id,
        },
      });
      await writeAdminAudit(tx, request, {
        adminId: admin.user.id, action: 'MODERATION_RULE_CREATE', targetType: 'MODERATION_RULE', targetId: created.id,
        reason: created.notes ?? '검토된 이중망 규칙 추가', after: created,
      });
      return created;
    });
    return json({ rule }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
