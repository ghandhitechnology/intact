export class RequestTimeoutError extends Error {
  constructor() {
    super('응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.');
    this.name = 'RequestTimeoutError';
  }
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function requestErrorMessage(error: unknown, fallback: string) {
  if (error instanceof RequestTimeoutError) return error.message;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return '인터넷 연결을 확인해 주세요.';
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12_000,
) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abortFromCaller();
  else init.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abortFromCaller);
  }
}
