export const REQUEST_ID_HEADER = 'X-Request-ID';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;

export function requestId(value?: string | null): string {
  const supplied = value?.trim();
  return supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : crypto.randomUUID();
}
