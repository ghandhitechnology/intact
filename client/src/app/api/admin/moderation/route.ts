import type { ModerationState } from '@prisma/client';
import prisma from '@/lib/prisma';
import { json, jsonError } from '@/lib/server/http';
import { requireReadyAdmin } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireReadyAdmin(request);
    const url = new URL(request.url);
    const requestedState = url.searchParams.get('state');
    const states: ModerationState[] = ['QUEUED', 'PROCESSING', 'NEEDS_REVIEW', 'ALLOWED', 'BLOCKED', 'FAILED', 'SUPERSEDED'];
    const state = states.includes(requestedState as ModerationState) ? requestedState as ModerationState : undefined;
    const submissions = await prisma.moderationSubmission.findMany({
      where: state ? { state } : { state: { in: ['QUEUED', 'PROCESSING', 'NEEDS_REVIEW', 'FAILED'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        author: { select: { id: true, nickname: true, realName: true, status: true } },
        post: { select: { id: true, status: true, title: true, contentText: true, board: { select: { name: true, slug: true } } } },
        attempts: { orderBy: { createdAt: 'asc' }, take: 20 },
      },
    });
    const rules = await prisma.moderationRule.findMany({ orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }], take: 200 });
    return json({ submissions, rules });
  } catch (error) {
    return jsonError(error);
  }
}
