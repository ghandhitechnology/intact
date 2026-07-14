import { ApiError } from './http';

function riroOrigin() {
  const configured = process.env.RIRO_BASE_URL || 'https://iscience.riroschool.kr';
  const url = new URL(configured);
  if (url.protocol !== 'https:' || url.hostname !== 'iscience.riroschool.kr') {
    throw new Error('RIRO_BASE_URL must be https://iscience.riroschool.kr');
  }
  return url.origin;
}
const USER_AGENT =
  'Mozilla/5.0 (compatible; InGwakPortal/1.0; +https://iscience.riroschool.kr)';

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

class InvalidCredentialsError extends Error {}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    if (entity.startsWith('#')) {
      const hexadecimal = entity[1]?.toLowerCase() === 'x';
      const number = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : '';
    }
    return named[entity.toLowerCase()] ?? '';
  });
}

function stripTags(value: string) {
  return decodeEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function textsForClass(html: string, className: string) {
  const values: string[] = [];
  const pattern = /<([a-z][a-z0-9:-]*)\b[^>]*\bclass\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const classes = match[2]?.split(/\s+/) ?? [];
    if (classes.includes(className)) values.push(stripTags(match[3] ?? ''));
  }
  return values;
}

function generationFromRiroId(riroId: string) {
  const match = riroId.match(/^(\d{2})/);
  if (!match) return null;
  const twoDigitYear = Number(match[1]);
  const entryYear = twoDigitYear >= 90 ? 1900 + twoDigitYear : 2000 + twoDigitYear;
  const generation = entryYear - 1994 + 1;
  return generation >= 1 && generation <= 99 ? generation : null;
}

function normalizeStudentNumber(raw: string) {
  const separated = raw.match(/([1-3])\D+([1-9])\D+(\d{1,2})(?:\D|$)/);
  let normalized: string;
  if (separated) {
    normalized = `${separated[1]}${separated[2]}${separated[3]?.padStart(2, '0')}`;
  } else {
    const digits = raw.replace(/\D/g, '');
    normalized = digits.length === 3
      ? `${digits.slice(0, 2)}0${digits.slice(2)}`
      : digits;
  }

  if (!/^[1-3][1-9]\d{2}$/.test(normalized)) return null;
  const studentNumber = Number(normalized.slice(2));
  if (studentNumber < 1 || studentNumber > 40) return null;
  return normalized;
}

function currentKoreanSchoolYear(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  return month < 3 ? year - 1 : year;
}

function parseProfile(html: string, submittedRiroId: string): RiroProfile | null {
  if (html.length > 2_000_000) return null;
  const inputValues = textsForClass(html, 'input_disabled');
  if (inputValues.length < 2) return null;

  const integrated = textsForClass(html, 'td_title')[0] === '통합아이디';
  const integratedIdentity = textsForClass(html, 'elem_fix')[0] ?? '';
  const effectiveRiroId = integrated && /^\d{2}/.test(integratedIdentity)
    ? integratedIdentity.slice(0, 8)
    : submittedRiroId;
  const generation = generationFromRiroId(effectiveRiroId);
  const currentStudentNumber = normalizeStudentNumber(inputValues[1] ?? '');
  const name = (inputValues[0] ?? '').normalize('NFKC').trim();

  if (!generation || !currentStudentNumber || !/^[가-힣A-Za-z .'-]{2,40}$/.test(name)) {
    return null;
  }

  const grade = Number(currentStudentNumber[0]);
  const classNumber = Number(currentStudentNumber[1]);
  const studentNumber = Number(currentStudentNumber.slice(2));
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

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timeout);
  }
}

async function authenticateOnce(riroId: string, password: string) {
  if (process.env.RIRO_AUTH_ENABLED === 'false') {
    throw new ApiError(503, 'RIRO_DISABLED', '리로스쿨 인증이 일시적으로 비활성화되어 있습니다.');
  }
  const origin = riroOrigin();
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    'User-Agent': USER_AGENT,
    Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
  };
  const loginResponse = await fetchWithTimeout(
    `${origin}/ajax.php`,
    {
      method: 'POST',
      headers,
      body: new URLSearchParams({
        app: 'user',
        mode: 'login',
        userType: '1',
        id: riroId,
        pw: password,
        deeplink: '',
        redirect_link: '',
      }),
      redirect: 'manual',
    },
    15_000,
  );

  if (!loginResponse.ok) throw new Error(`Riro login HTTP ${loginResponse.status}`);
  const loginPayload = (await loginResponse.json()) as { code?: unknown; token?: unknown };
  const code = String(loginPayload.code ?? '');
  if (code === '902') throw new InvalidCredentialsError();
  if (code !== '000' || typeof loginPayload.token !== 'string' || !loginPayload.token) {
    throw new Error(`Unexpected Riro login code ${code}`);
  }

  const profileResponse = await fetchWithTimeout(
    `${origin}/user.php`,
    {
      method: 'POST',
      headers: {
        ...headers,
        Cookie: `cookie_token=${encodeURIComponent(loginPayload.token)}`,
      },
      body: new URLSearchParams({ pw: password }),
      redirect: 'manual',
    },
    15_000,
  );
  if (!profileResponse.ok && profileResponse.status !== 302) {
    throw new Error(`Riro profile HTTP ${profileResponse.status}`);
  }

  const profile = parseProfile(await profileResponse.text(), riroId);
  if (!profile) throw new Error('Riro profile format changed');
  return profile;
}

/**
 * Verifies a Riro account without persisting or logging its credentials/token.
 * Only the normalized student profile returned by Riro leaves this function.
 */
export async function verifyRiroAccount(riroId: string, password: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
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
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }

  console.error('[riro] verification unavailable', lastError instanceof Error ? lastError.message : 'unknown');
  throw new ApiError(
    503,
    'RIRO_UNAVAILABLE',
    '리로스쿨 인증 서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  );
}
