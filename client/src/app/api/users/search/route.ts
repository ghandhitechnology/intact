import prisma from '@/lib/prisma';
import {
  enforceDistributedRateLimit,
  enforceRateLimit,
  json,
  jsonError,
} from '@/lib/server/http';
import { enrichPublicUserTree } from '@/lib/server/igk-standing';
import { getPlatformMode } from '@/lib/server/platform-mode';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    enforceRateLimit(`user-picker:${session.user.id}`, { limit: 40, windowMs: 60_000 });
    await enforceDistributedRateLimit(`user-picker:${session.user.id}`, {
      limit: 40,
      windowMs: 60_000,
      failPolicy: 'closed',
    });
    const query = new URL(request.url).searchParams.get('q')?.normalize('NFKC').trim() ?? '';
    if (query.length < 2 || query.length > 32) return json({ users: [] });
    const mode = await getPlatformMode();
    if (mode.bSideEnabled) return json({ users: [] });

    const users = await prisma.user.findMany({
      where: {
        id: { not: session.user.id },
        status: 'ACTIVE',
        studentIdentity: { isNot: null },
        OR: [
          { realName: { contains: query, mode: 'insensitive' } },
          { nickname: { contains: query, mode: 'insensitive' } },
          { studentIdentity: { studentCode: { startsWith: query } } },
        ],
      },
      orderBy: [{ realName: 'asc' }, { nickname: 'asc' }, { id: 'asc' }],
      take: 8,
      select: {
        id: true,
        realName: true,
        nickname: true,
        profileImage: true,
        profileImageAttachmentId: true,
        level: true,
        studentIdentity: { select: { studentCode: true } },
      },
    });
    return json({ users: await enrichPublicUserTree(users) });
  } catch (error) {
    return jsonError(error);
  }
}
