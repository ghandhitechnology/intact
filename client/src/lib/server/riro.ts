import { createHash, createHmac, randomBytes } from 'node:crypto';
import { ApiError } from './http';
import { currentKoreanSchoolYear } from './student-invites';

export interface RiroProfile {
  name: string;
  currentStudentNumber: string;
  generation: number;
  grade: number;
  classNumber: number;
  studentNumber: number;
  studentCode: string;
  schoolYear: number;
}

interface BridgeProfile {
  name?: unknown;
  currentStudentNumber?: unknown;
  generation?: unknown;
  role?: unknown;
}

interface BridgePayload {
  ok?: unknown;
  profile?: BridgeProfile;
  error?: { code?: unknown; message?: unknown };
}

class InvalidCredentialsError extends Error {}

function bridgeConfiguration() {
  if (process.env.RIRO_AUTH_MODE !== 'BRIDGE') {
    throw new ApiError(503, 'RIRO_DISABLED', '리로스쿨 인증이 일시적으로 비활성화되어 있습니다.');
  }
  const configuredUrl = process.env.RIRO_BRIDGE_URL ?? '';
  const secret = process.env.RIRO_BRIDGE_SECRET ?? '';
  if (secret.length < 32) throw new Error('RIRO_BRIDGE_SECRET must be at least 32 characters.');
  const url = new URL(configuredUrl);
  const tailscaleIpv4 = /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(url.hostname);
  const tailscaleDns = url.hostname.endsWith('.ts.net');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (tailscaleIpv4 || tailscaleDns))) {
    throw new Error('RIRO_BRIDGE_URL must use HTTPS or a Tailscale address.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('RIRO_BRIDGE_URL must not contain credentials, query parameters, or fragments.');
  }
  return { url: new URL('/v1/verify', url), secret };
}

export function signRiroBridgeRequest(body: string, secret: string, timestamp: string, nonce: string) {
  const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
  return createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${bodyHash}`, 'utf8')
    .digest('hex');
}

function normalizeBridgeProfile(profile: BridgeProfile): RiroProfile {
  const name = typeof profile.name === 'string' ? profile.name.normalize('NFKC').trim() : '';
  const currentStudentNumber = typeof profile.currentStudentNumber === 'string'
    ? profile.currentStudentNumber
    : '';
  const generation = Number(profile.generation);
  if (!/^[\p{L} .'-]{2,40}$/u.test(name)) throw new Error('Invalid bridge student name.');
  if (!/^[1-3][1-9]\d{2}$/.test(currentStudentNumber)) {
    throw new Error('Invalid bridge student number.');
  }
  const studentNumber = Number(currentStudentNumber.slice(2));
  if (studentNumber < 1 || studentNumber > 40) throw new Error('Invalid bridge student number.');
  if (!Number.isSafeInteger(generation) || generation < 1 || generation > 99) {
    throw new Error('Invalid bridge generation.');
  }
  const grade = Number(currentStudentNumber[0]);
  const classNumber = Number(currentStudentNumber[1]);
  return {
    name,
    currentStudentNumber,
    generation,
    grade,
    classNumber,
    studentNumber,
    studentCode: `${String(generation).padStart(2, '0')}${currentStudentNumber}`,
    schoolYear: currentKoreanSchoolYear(),
  };
}

async function authenticateOnce(riroId: string, password: string) {
  const { url, secret } = bridgeConfiguration();
  const body = JSON.stringify({ id: riroId, password });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(24).toString('base64url');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Riro-Timestamp': timestamp,
        'X-Riro-Nonce': nonce,
        'X-Riro-Signature': signRiroBridgeRequest(body, secret, timestamp, nonce),
      },
      body,
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) throw new Error('Riro bridge returned non-JSON.');
  const payload = await response.json() as BridgePayload;
  if (response.status === 401 && payload.error?.code === 'RIRO_INVALID_CREDENTIALS') {
    throw new InvalidCredentialsError();
  }
  if (!response.ok || payload.ok !== true || !payload.profile) {
    throw new Error(`Riro bridge failure ${response.status}`);
  }
  return normalizeBridgeProfile(payload.profile);
}

/**
 * Verifies a Riroschool account through the Korean Tailscale bridge. Credentials are never logged
 * or persisted; only the normalized student profile leaves this function.
 */
export async function verifyRiroAccount(riroId: string, password: string) {
  try {
    return await authenticateOnce(riroId, password);
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      throw new ApiError(
        401,
        'RIRO_INVALID_CREDENTIALS',
        '리로스쿨 아이디 또는 비밀번호가 올바르지 않습니다.',
      );
    }
    if (error instanceof ApiError) throw error;
    // Do not log caught exception text: fetch/decoder errors can include upstream content.
    console.error('[riro] bridge unavailable');
    throw new ApiError(
      503,
      'RIRO_UNAVAILABLE',
      '리로스쿨 인증 서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    );
  }
}
