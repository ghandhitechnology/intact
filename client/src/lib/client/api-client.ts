import { fetchWithTimeout, isAbortError, RequestTimeoutError } from '@/lib/client/request';
import { ContractParseError, type ContractParser, parseApiResult } from '@/lib/contracts/runtime';

type ApiClientErrorKind = 'aborted' | 'timeout' | 'network' | 'http' | 'api' | 'contract';

export class ApiClientError extends Error {
  constructor(
    public readonly kind: ApiClientErrorKind,
    public readonly code: string,
    message: string,
    public readonly options: {
      status?: number;
      details?: unknown;
      retryable?: boolean;
      retryAfterMs?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  get status() { return this.options.status; }
  get details() { return this.options.details; }
  get retryable() { return this.options.retryable ?? false; }
  get retryAfterMs() { return this.options.retryAfterMs; }
  get cause() { return this.options.cause; }
}

export interface ApiRequestOptions extends Omit<RequestInit, 'method' | 'signal'> {
  method?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  dedupe?: boolean;
  dedupeKey?: string;
  invalidate?: readonly string[];
}

type InFlightRequest = { resource: string; promise: Promise<unknown> };
type InvalidationListener = (resource: string) => void;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function resourceName(input: RequestInfo | URL) {
  const raw = input instanceof Request ? input.url : String(input);
  try {
    const base = typeof window === 'undefined' ? 'http://internal' : window.location.origin;
    const url = new URL(raw, base);
    return `${url.pathname}${url.search}`;
  } catch {
    return raw;
  }
}

function sameResource(subscription: string, resource: string) {
  const base = resource.split('?')[0];
  return subscription === resource || subscription === base || base.startsWith(`${subscription}/`);
}

function retryAfterMs(response: Response) {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function abortedError(reason?: unknown) {
  return new ApiClientError('aborted', 'REQUEST_ABORTED', '요청이 취소되었습니다.', {
    cause: reason,
    retryable: false,
  });
}

function wait(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError(signal.reason));
      return;
    }
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(abortedError(signal?.reason));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function withCallerCancellation<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortedError(signal.reason));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortedError(signal.reason));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export class ApiClient {
  private readonly inFlight = new Map<string, InFlightRequest>();
  private readonly listeners = new Map<string, Set<InvalidationListener>>();
  private readonly parserIds = new WeakMap<ContractParser<unknown>, number>();
  private nextParserId = 1;

  get<T>(input: RequestInfo | URL, parseData: ContractParser<T>, options: ApiRequestOptions = {}) {
    return this.request(input, parseData, { ...options, method: 'GET' });
  }

  request<T>(input: RequestInfo | URL, parseData: ContractParser<T>, options: ApiRequestOptions = {}) {
    const method = (options.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const resource = resourceName(input);
    const shouldDedupe = method === 'GET' && options.dedupe !== false;
    const key = shouldDedupe ? this.requestKey(resource, parseData, options) : '';
    const existing = key ? this.inFlight.get(key) : undefined;
    if (existing) return withCallerCancellation(existing.promise as Promise<T>, options.signal);

    const sharedOptions = shouldDedupe ? { ...options, signal: undefined } : options;
    const promise = this.execute<T>(input, parseData, method, sharedOptions)
      .then((data) => {
        for (const target of options.invalidate ?? []) this.invalidate(target);
        return data;
      });

    if (key) {
      this.inFlight.set(key, { resource, promise });
      void promise.finally(() => {
        if (this.inFlight.get(key)?.promise === promise) this.inFlight.delete(key);
      }).catch(() => undefined);
    }
    return withCallerCancellation(promise, options.signal);
  }

  invalidate(resource: string) {
    for (const [key, request] of this.inFlight) {
      if (sameResource(resource, request.resource)) this.inFlight.delete(key);
    }
    for (const [subscription, listeners] of this.listeners) {
      if (!sameResource(subscription, resource)) continue;
      for (const listener of listeners) listener(resource);
    }
  }

  onInvalidated(resource: string, listener: InvalidationListener) {
    const listeners = this.listeners.get(resource) ?? new Set<InvalidationListener>();
    listeners.add(listener);
    this.listeners.set(resource, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(resource);
    };
  }

  private requestKey<T>(resource: string, parser: ContractParser<T>, options: ApiRequestOptions) {
    const parserKey = parser as ContractParser<unknown>;
    let parserId = this.parserIds.get(parserKey);
    if (!parserId) {
      parserId = this.nextParserId++;
      this.parserIds.set(parserKey, parserId);
    }
    const headers = Array.from(new Headers(options.headers).entries())
      .sort(([left], [right]) => left.localeCompare(right));
    return options.dedupeKey ?? JSON.stringify(['GET', resource, headers, parserId]);
  }

  private async execute<T>(
    input: RequestInfo | URL,
    parseData: ContractParser<T>,
    method: string,
    options: ApiRequestOptions,
  ): Promise<T> {
    const idempotentRead = method === 'GET' || method === 'HEAD';
    const retries = idempotentRead ? Math.max(0, options.retries ?? 1) : 0;
    let attempt = 0;
    while (true) {
      if (options.signal?.aborted) throw abortedError(options.signal.reason);
      try {
        return await this.executeOnce(input, parseData, method, options);
      } catch (cause) {
        const error = this.normalizeError(cause);
        if (attempt >= retries || !error.retryable) throw error;
        const delay = error.retryAfterMs ?? (options.retryDelayMs ?? 150) * (2 ** attempt);
        attempt += 1;
        await wait(delay, options.signal);
      }
    }
  }

  private async executeOnce<T>(
    input: RequestInfo | URL,
    parseData: ContractParser<T>,
    method: string,
    options: ApiRequestOptions,
  ) {
    const {
      timeoutMs = 12_000,
      retries: _retries,
      retryDelayMs: _retryDelayMs,
      dedupe: _dedupe,
      dedupeKey: _dedupeKey,
      invalidate: _invalidate,
      ...init
    } = options;
    const response = await fetchWithTimeout(input, { ...init, method, signal: options.signal }, timeoutMs);
    const text = await response.text();
    let raw: unknown;
    try {
      raw = text ? JSON.parse(text) : null;
    } catch (cause) {
      throw new ApiClientError('contract', 'INVALID_JSON', '서버 응답을 읽을 수 없습니다.', {
        status: response.status,
        cause,
      });
    }

    if (!response.ok) {
      try {
        const result = parseApiResult(raw, parseData);
        if (!result.ok) {
          throw new ApiClientError('api', result.error.code, result.error.message, {
            status: response.status,
            details: result.error.details,
            retryable: RETRYABLE_STATUS.has(response.status),
            retryAfterMs: retryAfterMs(response),
          });
        }
      } catch (cause) {
        if (cause instanceof ApiClientError) throw cause;
      }
      throw new ApiClientError('http', `HTTP_${response.status}`, '요청을 처리하지 못했습니다.', {
        status: response.status,
        retryable: RETRYABLE_STATUS.has(response.status),
        retryAfterMs: retryAfterMs(response),
      });
    }

    try {
      const result = parseApiResult(raw, parseData);
      if (!result.ok) {
        throw new ApiClientError('api', result.error.code, result.error.message, {
          details: result.error.details,
        });
      }
      return result.data;
    } catch (cause) {
      if (cause instanceof ApiClientError) throw cause;
      throw new ApiClientError('contract', 'INVALID_RESPONSE', '서버 응답 형식이 올바르지 않습니다.', {
        cause,
        details: cause instanceof ContractParseError ? cause.issues : undefined,
      });
    }
  }

  private normalizeError(cause: unknown) {
    if (cause instanceof ApiClientError) return cause;
    if (cause instanceof RequestTimeoutError) {
      return new ApiClientError('timeout', 'REQUEST_TIMEOUT', cause.message, { cause, retryable: true });
    }
    if (isAbortError(cause)) return abortedError(cause);
    return new ApiClientError('network', 'NETWORK_ERROR', '네트워크 연결을 확인해 주세요.', {
      cause,
      retryable: true,
    });
  }
}

export const apiClient = new ApiClient();
export const invalidateResource = (resource: string) => apiClient.invalidate(resource);
export const onResourceInvalidated = (resource: string, listener: InvalidationListener) =>
  apiClient.onInvalidated(resource, listener);
