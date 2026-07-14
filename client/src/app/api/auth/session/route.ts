import { json, jsonError } from '@/lib/server/http';
import { publicUser, resolveSession } from '@/lib/server/session';
import { secureStringEqual } from '@/lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await resolveSession(request);
    if (!session || session.user.status !== 'ACTIVE') {
      return json({
        authenticated: false as const,
        reason: session?.user.status ?? null,
      });
    }
    const internalSecret = process.env.INTERNAL_API_SECRET;
    const suppliedInternalSecret = request.headers.get('x-igwak-internal');
    if (
      internalSecret &&
      suppliedInternalSecret &&
      secureStringEqual(internalSecret, suppliedInternalSecret)
    ) {
      return Response.json(
        {
          user: {
            id: session.user.id,
            nickname: session.user.realName ?? session.user.nickname,
            realName: session.user.realName ?? session.user.nickname,
            studentId: session.user.studentIdentity?.studentCode ?? session.user.loginId,
          },
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return json({
      authenticated: true as const,
      user: publicUser(session.user),
      currentIgk: session.user.currentIgk,
      lifetimeIgk: session.user.lifetimeIgk,
      mustChangePassword: session.user.mustChangePassword,
      expiresAt: session.expiresAt.toISOString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
