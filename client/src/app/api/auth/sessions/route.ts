import prisma from '@/lib/prisma';
import {
  ApiError,
  assertSameOrigin,
  json,
  jsonError,
  readJson,
} from '@/lib/server/http';
import { clearSessionCookie, requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const current = await requireUser(request);
    const sessions = await prisma.session.findMany({
      where: {
        userId: current.user.id,
        scope: 'PORTAL',
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        lastSeenAt: true,
        userAgent: true,
      },
    });
    return json({
      sessions: sessions.map((session) => ({
        ...session,
        current: session.id === current.id,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const current = await requireUser(request);
    const body = await readJson<{ sessionId?: unknown; all?: unknown; allOthers?: unknown }>(request);
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
    if (!sessionId && body.all !== true && body.allOthers !== true) {
      throw new ApiError(400, 'INVALID_SESSION_ACTION', '종료할 세션을 지정해 주세요.');
    }
    const result = await prisma.session.updateMany({
      where: {
        userId: current.user.id,
        scope: 'PORTAL',
        revokedAt: null,
        ...(sessionId
          ? { id: sessionId }
          : body.allOthers === true
            ? { id: { not: current.id } }
            : {}),
      },
      data: { revokedAt: new Date() },
    });
    const response = json({ revokedSessions: result.count });
    return body.all === true || sessionId === current.id
      ? clearSessionCookie(response)
      : response;
  } catch (error) {
    return jsonError(error);
  }
}
