import type { ApiFailure, ApiSuccess, PaginationMeta } from '@/types/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

export function json<T>(data: T, status = 200, headers?: HeadersInit) {
  const body: ApiSuccess<T> = { ok: true, data };
  return new Response(
    JSON.stringify(body, (_, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
    {
    status,
    headers: { ...JSON_HEADERS, ...headers },
    },
  );
}

export function jsonError(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    (error as { digest?: string }).digest === 'DYNAMIC_SERVER_USAGE'
  ) {
    throw error;
  }
  const isApiError = error instanceof ApiError;
  const status = isApiError ? error.status : 500;
  const body: ApiFailure = {
    ok: false,
    error: {
      code: isApiError ? error.code : 'INTERNAL_ERROR',
      message: isApiError
        ? error.message
        : '요청을 처리하는 중 오류가 발생했습니다.',
      ...(isApiError && error.details !== undefined
        ? { details: error.details }
        : {}),
    },
  };

  if (!isApiError) {
    // Never include request bodies, credentials, or raw upstream responses.
    console.error('[api] unhandled error', error);
  }

  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (
    status === 429 &&
    isApiError &&
    typeof error.details === 'object' &&
    error.details !== null &&
    'retryAfter' in error.details
  ) {
    const retryAfter = Number((error.details as { retryAfter?: unknown }).retryAfter);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      headers['Retry-After'] = String(Math.ceil(retryAfter));
    }
  }

  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

export async function readJson<T>(request: Request, maxBytes = 32_768): Promise<T> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 요청만 지원합니다.');
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '요청 본문이 너무 큽니다.');
  }

  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = '';
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '요청 본문이 너무 큽니다.');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', '올바른 JSON 형식이 아닙니다.');
  }
}

export function requiredString(
  value: unknown,
  field: string,
  options: { min?: number; max?: number; trim?: boolean } = {},
) {
  if (typeof value !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} 값을 입력해 주세요.`);
  }

  const normalized = options.trim === false ? value : value.trim();
  const min = options.min ?? 1;
  const max = options.max ?? 10_000;
  if (normalized.length < min || normalized.length > max) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `${field} 값은 ${min}자 이상 ${max}자 이하여야 합니다.`,
    );
  }
  if (normalized.includes('\u0000')) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} 값에 허용되지 않는 문자가 있습니다.`);
  }
  return normalized;
}

export function optionalString(value: unknown, field: string, max: number) {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, field, { max });
}

export function requiredInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `${field} 값은 ${min} 이상 ${max} 이하의 정수여야 합니다.`,
    );
  }
  return number;
}

export function parsePagination(url: URL, maxPageSize = 50) {
  const page = requiredInteger(url.searchParams.get('page') ?? 1, 'page', 1, 100_000);
  const pageSize = requiredInteger(
    url.searchParams.get('pageSize') ?? 20,
    'pageSize',
    1,
    maxPageSize,
  );
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function paginationMeta(page: number, pageSize: number, total: number): PaginationMeta {
  return {
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function getClientIp(request: Request) {
  const runtimeIp = (request as Request & { ip?: string }).ip?.trim();
  if (runtimeIp) return runtimeIp.slice(0, 64);
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = request.headers.get('x-forwarded-for');
    return (
      forwarded?.split(',')[0]?.trim().slice(0, 64) ||
      request.headers.get('x-real-ip')?.trim().slice(0, 64) ||
      'trusted-proxy-unknown'
    );
  }
  // Never trust caller-controlled forwarding headers on a directly published port.
  return 'direct-unproxied';
}

export function enforceClientIpRateLimit(
  request: Request,
  prefix: string,
  options: { limit: number; windowMs: number },
) {
  const ip = getClientIp(request);
  // Self-hosted Next.js may not expose the socket IP. Do not turn that absence
  // into one school-wide bucket; account/ticket/user limits still apply.
  if (ip === 'direct-unproxied') return;
  enforceRateLimit(`${prefix}:${ip}`, options);
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  let expectedOrigin = new URL(request.url).origin;
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL;
  if (configuredOrigin) {
    try {
      expectedOrigin = new URL(configuredOrigin).origin;
    } catch {
      throw new ApiError(500, 'INVALID_APP_ORIGIN', '서비스 공개 주소 설정이 올바르지 않습니다.');
    }
  } else if (process.env.TRUST_PROXY === 'true') {
    const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    if (
      (forwardedProto === 'https' || forwardedProto === 'http') &&
      forwardedHost &&
      /^[A-Za-z0-9.:[\]-]+$/.test(forwardedHost)
    ) {
      expectedOrigin = `${forwardedProto}://${forwardedHost}`;
    }
  }
  if (origin !== expectedOrigin) {
    throw new ApiError(403, 'INVALID_ORIGIN', '허용되지 않은 출처의 요청입니다.');
  }
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

export function enforceRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (rateBuckets.size >= 10_000) {
      for (const [bucketKey, value] of Array.from(rateBuckets.entries())) {
        if (value.resetAt <= now) rateBuckets.delete(bucketKey);
      }
      while (rateBuckets.size >= 10_000) {
        const oldestKey = rateBuckets.keys().next().value as string | undefined;
        if (!oldestKey) break;
        rateBuckets.delete(oldestKey);
      }
    }
    rateBuckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return;
  }

  bucket.count += 1;
  if (bucket.count > options.limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    throw new ApiError(
      429,
      'RATE_LIMITED',
      `요청이 너무 많습니다. ${retryAfter}초 후 다시 시도해 주세요.`,
      { retryAfter },
    );
  }

}

export function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

export function plainTextFromMarkup(content: string) {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_>`~\[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
