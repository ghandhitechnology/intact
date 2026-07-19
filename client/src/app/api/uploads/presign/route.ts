import { ApiError, assertSameOrigin, jsonError } from '@/lib/server/http';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireUser(request);
    throw new ApiError(410, 'DIRECT_UPLOAD_RETIRED', '파일은 /api/uploads로 올려 주세요.');
  } catch (error) {
    return jsonError(error);
  }
}
