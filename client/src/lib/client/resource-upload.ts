import { fetchWithTimeout } from './request';

export const RESOURCE_FILE_MAX_BYTES = 500 * 1024 * 1024;
export const RESOURCE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: { message?: unknown };
};

class UploadApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'UploadApiError';
  }
}

type MultipartInit = {
  attachment: {
    id: string;
    partSize: number;
    partCount: number;
    partUrlsEndpoint: string;
    completeEndpoint: string;
    statusUrl: string;
  };
};

type SignedParts = {
  parts: Array<{ partNumber: number; url: string }>;
};

type UploadStatus = {
  attachment: {
    scanStatus: string;
    ready: boolean;
    terminal: boolean;
    processingError?: string | null;
  };
};

export type ResourceUploadProgress = {
  phase: 'uploading' | 'scanning';
  percent: number;
};

function responseMessage(payload: ApiEnvelope<unknown> | null, fallback: string) {
  return typeof payload?.error?.message === 'string' ? payload.error.message : fallback;
}

async function apiJson<T>(url: string, init: RequestInit, timeoutMs = 30_000) {
  const response = await fetchWithTimeout(url, init, timeoutMs);
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!response.ok || payload?.ok !== true || !payload.data) {
    throw new UploadApiError(
      responseMessage(payload, '파일 전송 요청을 처리하지 못했습니다.'),
      response.status,
    );
  }
  return payload.data;
}

const RETRYABLE_API_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

async function retryApiJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs = 30_000,
  attempts = 3,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await apiJson<T>(url, init, timeoutMs);
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted) throw error;
      if (error instanceof UploadApiError && !RETRYABLE_API_STATUS.has(error.status)) throw error;
      if (attempt + 1 < attempts) await wait(400 * (2 ** attempt), init.signal ?? undefined);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('파일 전송 요청에 실패했습니다.');
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function resourcePartRanges(size: number, partSize: number) {
  if (!Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(partSize) || partSize < 1) {
    throw new Error('Invalid multipart file size.');
  }
  return Array.from({ length: Math.ceil(size / partSize) }, (_, index) => ({
    partNumber: index + 1,
    start: index * partSize,
    end: Math.min(size, (index + 1) * partSize),
  }));
}

async function uploadPart(url: string, body: Blob, signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = window.setTimeout(() => controller.abort(), 5 * 60_000);
  try {
    return await fetch(url, {
      method: 'PUT',
      body,
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

const RETRYABLE_PART_STATUS = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

class NonRetryablePartError extends Error {}

export async function uploadResourceFile(
  file: File,
  options: {
    onProgress?: (progress: ResourceUploadProgress) => void;
    signal?: AbortSignal;
  } = {},
) {
  const initialized = await apiJson<MultipartInit>('/api/uploads/multipart', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      board: 'resources',
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
    }),
    signal: options.signal,
  });
  const attachment = initialized.attachment;
  let completed = false;
  try {
    const ranges = resourcePartRanges(file.size, attachment.partSize);
    if (ranges.length !== attachment.partCount) {
      throw new Error('서버와 브라우저의 파일 조각 수가 일치하지 않습니다.');
    }
    const completedParts: Array<{ partNumber: number; etag: string }> = [];
    let uploadedBytes = 0;
    for (let offset = 0; offset < ranges.length; offset += 6) {
      const batch = ranges.slice(offset, offset + 6);
      const signed = await retryApiJson<SignedParts>(attachment.partUrlsEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ partNumbers: batch.map((part) => part.partNumber) }),
        signal: options.signal,
      });
      const urls = new Map(signed.parts.map((part) => [part.partNumber, part.url]));
      await Promise.all(batch.map(async (part) => {
        let url = urls.get(part.partNumber);
        if (!url) throw new Error('파일 조각 전송 주소를 받지 못했습니다.');
        const blob = file.slice(part.start, part.end);
        let lastError: unknown;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            const response = await uploadPart(url, blob, options.signal);
            const etag = response.headers.get('etag');
            if (response.ok && etag && /^"?[a-f0-9]{32}(?:-\d+)?"?$/i.test(etag)) {
              completedParts.push({ partNumber: part.partNumber, etag });
              uploadedBytes += blob.size;
              options.onProgress?.({
                phase: 'uploading',
                percent: Math.min(99, Math.round((uploadedBytes / file.size) * 100)),
              });
              return;
            }
            if (!RETRYABLE_PART_STATUS.has(response.status)) {
              throw new NonRetryablePartError(`파일 조각 전송이 HTTP ${response.status}로 거절되었습니다.`);
            }
            lastError = new Error(`파일 조각 전송이 HTTP ${response.status}로 지연되고 있습니다.`);
            if (response.status === 403) {
              const refreshed = await retryApiJson<SignedParts>(attachment.partUrlsEndpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ partNumbers: [part.partNumber] }),
                signal: options.signal,
              });
              url = refreshed.parts[0]?.url;
              if (!url) throw new Error('만료된 파일 전송 주소를 갱신하지 못했습니다.');
            }
          } catch (error) {
            if (error instanceof NonRetryablePartError) throw error;
            if (options.signal?.aborted) throw error;
            lastError = error;
          }
          if (attempt < 3) await wait(500 * (2 ** attempt), options.signal);
        }
        throw lastError instanceof Error ? lastError : new Error('파일 조각 전송에 실패했습니다.');
      }));
    }

    completedParts.sort((left, right) => left.partNumber - right.partNumber);
    await retryApiJson(attachment.completeEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parts: completedParts }),
      signal: options.signal,
    }, 60_000);
    completed = true;
    options.onProgress?.({ phase: 'scanning', percent: 100 });
    return { id: attachment.id, statusUrl: attachment.statusUrl };
  } finally {
    if (!completed) {
      await fetchWithTimeout(`/api/uploads/${encodeURIComponent(attachment.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
      }, 20_000).catch(() => undefined);
    }
  }
}

export async function waitForAttachmentReady(
  attachmentId: string,
  options: {
    onProgress?: (progress: ResourceUploadProgress) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
) {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 20 * 60_000;
  options.onProgress?.({ phase: 'scanning', percent: 100 });
  while (Date.now() - started < timeoutMs) {
    const status = await retryApiJson<UploadStatus>(
      `/api/uploads/${encodeURIComponent(attachmentId)}/status`,
      { method: 'GET', cache: 'no-store', signal: options.signal },
      20_000,
    );
    if (status.attachment.ready) return;
    if (status.attachment.terminal) {
      throw new Error(status.attachment.processingError || '파일 안전 검사에 실패했습니다. 파일을 다시 확인해 주세요.');
    }
    await wait(1_500, options.signal);
  }
  throw new Error('파일 안전 검사가 오래 걸리고 있습니다. 잠시 후 다시 저장해 주세요.');
}
