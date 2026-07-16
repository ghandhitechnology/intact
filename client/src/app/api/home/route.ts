import { createHash } from 'node:crypto';
import { jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readEndpoint(origin: string, path: string, cookie: string) {
  const response = await fetch(`${origin}${path}`, {
    headers: { cookie },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(`HOME_SOURCE_FAILED:${path}`);
  return body.data ?? body;
}

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const configuredOrigin = process.env.INTERNAL_API_URL?.replace(/\/$/, '');
    const origin = configuredOrigin || new URL(request.url).origin;
    const cookie = request.headers.get('cookie') || '';
    const [boards, notices, ranking, notifications, balance] = await Promise.all([
      readEndpoint(origin, '/api/boards', cookie),
      readEndpoint(origin, '/api/notices?limit=10', cookie),
      readEndpoint(origin, '/api/igk/ranking', cookie),
      readEndpoint(origin, '/api/notifications?pageSize=1', cookie),
      readEndpoint(origin, '/api/igk/balance', cookie),
    ]);
    const stablePayload = {
      boards: boards.boards || [],
      notices: notices.notices || [],
      leaders: ranking.leaders || [],
      account: {
        currentIgk: Number(balance.currentIgk ?? session.user.currentIgk ?? 0),
        jojolRank: Number.isInteger(balance.jojolRank) ? Number(balance.jojolRank) : null,
        unreadCount: Number(notifications.unreadCount || 0),
      },
    };
    const payload = {
      ...stablePayload,
      generatedAt: new Date().toISOString(),
    };
    const body = JSON.stringify({ ok: true, data: payload });
    const etag = `"${createHash('sha256').update(JSON.stringify(stablePayload)).digest('base64url').slice(0, 24)}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'private, no-cache' } });
    }
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'private, no-cache',
        ETag: etag,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
