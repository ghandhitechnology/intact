import { jsonError, ApiError } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function POST() {
  return jsonError(
    new ApiError(
      410,
      'LEGACY_REGISTRATION_DISABLED',
      '안전한 리로스쿨 인증 가입 절차(/api/auth/riro/verify → /api/auth/register)를 이용해 주세요.',
    ),
  );
}
