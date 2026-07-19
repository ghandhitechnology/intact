import { createHash } from 'node:crypto';
import { jsonError } from '@/lib/server/http';
import { loadHomeData } from '@/lib/server/home-service';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const payload = await loadHomeData({
      request,
      currentIgk: session.user.currentIgk,
    });
    const { generatedAt: _generatedAt, ...stablePayload } = payload;
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
