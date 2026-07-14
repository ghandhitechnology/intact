import { assertSameOrigin, json, jsonError } from '@/lib/server/http';
import { clearSessionCookie, revokeRequestSession } from '@/lib/server/session';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await revokeRequestSession(request);
    return clearSessionCookie(json({ loggedOut: true }));
  } catch (error) {
    return jsonError(error);
  }
}
