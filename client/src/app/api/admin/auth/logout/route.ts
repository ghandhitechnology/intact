import { assertSameOrigin, json, jsonError } from '@/lib/server/http';
import { clearAdminSessionCookie, revokeAdminRequestSession } from '@/lib/server/session';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await revokeAdminRequestSession(request);
    return clearAdminSessionCookie(json({ loggedOut: true }));
  } catch (error) {
    return jsonError(error);
  }
}
