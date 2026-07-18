import { REQUEST_ID_HEADER, requestId } from '@/lib/request-id';
import { logStructuredError } from '@/lib/server/observability';
import { consumeRedisTokenBucket, type RateLimitFailPolicy } from '@/lib/server/rate-limit-redis';
import type { ApiFailure, ApiSuccess, PaginationMeta } from '@/types/api';
import { isIP } from 'node:net';
import { secureStringEqual } from './crypto';

export { requestId } from '@/lib/request-id';

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

function jsonHeaders(headers?: HeadersInit, id = requestId()) {
  const result = new Headers(headers);
  for (const [name, value] of Object.entries(JSON_HEADERS)) {
    if (!result.has(name)) result.set(name, value);
  }
  result.set(REQUEST_ID_HEADER, requestId(result.get(REQUEST_ID_HEADER) ?? id));
  return result;
}

export function json<T>(data: T, status = 200, headers?: HeadersInit) {
  const body: ApiSuccess<T> = { ok: true, data };
  return new Response(
    JSON.stringify(body, (_, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
    {
      status,
      headers: jsonHeaders(headers),
    },
  );
}

export function jsonError(error: unknown, suppliedRequestId?: string | null) {
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

  const id = requestId(suppliedRequestId);
  if (!isApiError) logStructuredError('api.unhandled_error', error, { requestId: id });

  const headers = jsonHeaders(undefined, id);
  if (
    (status === 429 || (status === 503 && isApiError && error.code === 'RATE_LIMIT_UNAVAILABLE')) &&
    isApiError &&
    typeof error.details === 'object' &&
    error.details !== null &&
    'retryAfter' in error.details
  ) {
    const retryAfter = Number((error.details as { retryAfter?: unknown }).retryAfter);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      headers.set('Retry-After', String(Math.ceil(retryAfter)));
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
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^-?\d+$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
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
  const validIp = (value: string | null | undefined) => {
    const normalized = value?.trim();
    if (!normalized || normalized.length > 64) return null;
    const unwrapped = normalized.startsWith('[') && normalized.endsWith(']')
      ? normalized.slice(1, -1)
      : normalized;
    return isIP(unwrapped) ? unwrapped : null;
  };
  const runtimeIp = validIp((request as Request & { ip?: string }).ip);
  if (runtimeIp) return runtimeIp;
  if (process.env.TRUST_PROXY === 'true') {
    // The deployment proxy overwrites X-Real-IP. X-Forwarded-For can contain
    // a caller-supplied chain, so it must never select the rate-limit identity.
    return validIp(request.headers.get('x-real-ip')) || 'trusted-proxy-unknown';
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

export async function enforceDistributedClientIpRateLimit(
  request: Request,
  prefix: string,
  options: { limit: number; windowMs: number; failPolicy: RateLimitFailPolicy },
) {
  const ip = getClientIp(request);
  if (ip === 'direct-unproxied') return null;
  return enforceDistributedRateLimit(`${prefix}:${ip}`, options);
}

export function assertSameOrigin(
  request: Request,
  options: { allowRealtimeGateway?: boolean } = {},
) {
  const origin = request.headers.get('origin');
  if (!origin) {
    const internalSecret = process.env.INTERNAL_API_SECRET;
    const realtimeSecret = request.headers.get('x-igwak-realtime-origin');
    if (
      options.allowRealtimeGateway
      && internalSecret
      && realtimeSecret
      && secureStringEqual(internalSecret, realtimeSecret)
    ) return;

    // CSRF does not apply to a non-cookie API client that supplies its token
    // explicitly. A bad token is still rejected by requireUser afterwards.
    const authorization = request.headers.get('authorization') || '';
    if (/^Bearer\s+\S+$/i.test(authorization) && !request.headers.get('cookie')) return;
    throw new ApiError(403, 'MISSING_ORIGIN', '출처를 확인할 수 없는 요청입니다.');
  }
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

export async function enforceDistributedRateLimit(
  key: string,
  options: { limit: number; windowMs: number; failPolicy: RateLimitFailPolicy },
) {
  if (!process.env.REDIS_URL && process.env.NODE_ENV !== 'production') return null;
  const result = await consumeRedisTokenBucket({
    key,
    capacity: options.limit,
    refillPerSecond: options.limit / (options.windowMs / 1_000),
    failPolicy: options.failPolicy,
  });
  if (result.allowed) return result;
  const retryAfter = Math.max(1, Math.ceil(result.retryAfterMs / 1_000));
  if (result.source === 'fail-closed') {
    throw new ApiError(
      503,
      'RATE_LIMIT_UNAVAILABLE',
      '요청 보호 서비스를 확인하는 중입니다. 잠시 후 다시 시도해 주세요.',
      { retryAfter },
    );
  }
  throw new ApiError(
    429,
    'RATE_LIMITED',
    `요청이 너무 많습니다. ${retryAfter}초 후 다시 시도해 주세요.`,
    { retryAfter },
  );
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
