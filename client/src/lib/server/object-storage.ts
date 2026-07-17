import { createHash, createHmac } from 'crypto';

type StorageMethod = 'GET' | 'PUT' | 'POST' | 'DELETE' | 'HEAD';

type StorageRequestOptions = {
  body?: Uint8Array;
  contentType?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
};

function config() {
  const endpoint = new URL(process.env.S3_ENDPOINT || 'http://minio:9000');
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET || 'igwak-uploads';
  const region = process.env.S3_REGION || 'auto';
  if (!accessKey || !secretKey) throw new Error('Object storage credentials are not configured.');
  return { endpoint, accessKey, secretKey, bucket, region };
}

function hash(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest();
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodedPath(bucket: string, key: string) {
  return `/${awsEncode(bucket)}/${key.split('/').map(awsEncode).join('/')}`;
}

function canonicalQuery(query: Record<string, string>) {
  return Object.entries(query)
    .map(([name, value]) => [awsEncode(name), awsEncode(value)] as const)
    // SigV4 requires raw byte ordering. localeCompare() can place lowercase
    // parameters before X-Amz-* and produce a signature MinIO rejects.
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      if (leftName !== rightName) return leftName < rightName ? -1 : 1;
      if (leftValue === rightValue) return 0;
      return leftValue < rightValue ? -1 : 1;
    })
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

function signingKey(secretKey: string, day: string, region: string) {
  const dateKey = hmac(`AWS4${secretKey}`, day);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

async function storageRequest(
  method: StorageMethod,
  key: string,
  options: StorageRequestOptions = {},
) {
  const { endpoint, accessKey, secretKey, bucket, region } = config();
  const now = new Date();
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const payloadHash = hash(options.body ?? new Uint8Array());
  const path = `${endpoint.pathname.replace(/\/$/, '')}${encodedPath(bucket, key)}`;
  const query = canonicalQuery(options.query ?? {});
  const headers: Record<string, string> = {
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': date,
    ...Object.fromEntries(
      Object.entries(options.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value.trim()]),
    ),
  };
  if (options.contentType) headers['content-type'] = options.contentType;
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]?.trim()}\n`).join('');
  const canonicalRequest = [
    method,
    path,
    query,
    canonicalHeaders,
    signedHeaderNames.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, hash(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(secretKey, day, region))
    .update(stringToSign)
    .digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`;

  const url = new URL(`${path}${query ? `?${query}` : ''}`, endpoint.origin);
  // Bound connection/response-header latency without aborting a successful
  // response body while Next.js streams a large attachment to a slow client.
  const controller = new AbortController();
  const responseTimeout = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(url, {
      method,
      headers,
      body: options.body ? (options.body as BodyInit) : undefined,
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(responseTimeout);
  }
}

export function presignObjectRequest(
  method: 'GET' | 'PUT',
  key: string,
  publicEndpoint: string | URL,
  options: {
    expiresSeconds?: number;
    query?: Record<string, string>;
    now?: Date;
  } = {},
) {
  const { accessKey, secretKey, bucket, region } = config();
  const endpoint = new URL(publicEndpoint);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('The public object-storage endpoint must be an origin URL.');
  }
  const now = options.now ?? new Date();
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const expiresSeconds = Math.min(3_600, Math.max(60, Math.floor(options.expiresSeconds ?? 900)));
  const scope = `${day}/${region}/s3/aws4_request`;
  const path = `${endpoint.pathname.replace(/\/$/, '')}${encodedPath(bucket, key)}`;
  const query: Record<string, string> = {
    ...(options.query ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${scope}`,
    'X-Amz-Date': date,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonical = canonicalQuery(query);
  const canonicalRequest = [
    method,
    path,
    canonical,
    `host:${endpoint.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    date,
    scope,
    hash(canonicalRequest),
  ].join('\n');
  query['X-Amz-Signature'] = createHmac('sha256', signingKey(secretKey, day, region))
    .update(stringToSign)
    .digest('hex');
  return new URL(`${path}?${canonicalQuery(query)}`, endpoint.origin).toString();
}

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  const response = await storageRequest('PUT', key, { body, contentType });
  if (!response.ok) throw new Error(`Object upload failed with HTTP ${response.status}.`);
}

export async function copyObject(sourceKey: string, destinationKey: string) {
  const { bucket } = config();
  const response = await storageRequest('PUT', destinationKey, {
    headers: { 'x-amz-copy-source': encodedPath(bucket, sourceKey) },
  });
  if (!response.ok) throw new Error(`Object copy failed with HTTP ${response.status}.`);
}

export async function createMultipartUpload(key: string, contentType: string) {
  const response = await storageRequest('POST', key, {
    contentType,
    query: { uploads: '' },
  });
  if (!response.ok) throw new Error(`Multipart upload initialization failed with HTTP ${response.status}.`);
  const xml = await response.text();
  const uploadId = xml.match(/<UploadId>([^<]{1,700})<\/UploadId>/)?.[1];
  if (!uploadId) throw new Error('Multipart upload initialization returned no upload ID.');
  return uploadId
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function presignMultipartPart(
  key: string,
  uploadId: string,
  partNumber: number,
  publicEndpoint: string | URL,
  expiresSeconds = 900,
) {
  return presignObjectRequest('PUT', key, publicEndpoint, {
    expiresSeconds,
    query: { partNumber: String(partNumber), uploadId },
  });
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>,
) {
  const xmlParts = parts.map(({ partNumber, etag }) => {
    if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      throw new Error('Invalid multipart part number.');
    }
    if (!/^"?[a-f0-9]{32}(?:-\d+)?"?$/i.test(etag)) {
      throw new Error('Invalid multipart ETag.');
    }
    const normalizedEtag = etag.startsWith('"') ? etag : `"${etag}"`;
    return `<Part><PartNumber>${partNumber}</PartNumber><ETag>${normalizedEtag}</ETag></Part>`;
  }).join('');
  const body = Buffer.from(`<CompleteMultipartUpload>${xmlParts}</CompleteMultipartUpload>`, 'utf8');
  const response = await storageRequest('POST', key, {
    body,
    contentType: 'application/xml',
    query: { uploadId },
  });
  if (!response.ok) throw new Error(`Multipart upload completion failed with HTTP ${response.status}.`);
  const xml = await response.text();
  if (/<Error(?:\s|>)/.test(xml)) {
    throw new Error('Object storage reported an error while completing the multipart upload.');
  }
}

export async function abortMultipartUpload(key: string, uploadId: string) {
  const response = await storageRequest('DELETE', key, { query: { uploadId } });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Multipart upload cancellation failed with HTTP ${response.status}.`);
  }
}

export async function headObject(key: string) {
  const response = await storageRequest('HEAD', key);
  if (!response.ok) throw new Error(`Object metadata lookup failed with HTTP ${response.status}.`);
  const size = Number(response.headers.get('content-length'));
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('Object storage returned an invalid size.');
  return { size, etag: response.headers.get('etag') };
}

export async function getObject(key: string) {
  const response = await storageRequest('GET', key);
  if (!response.ok) throw new Error(`Object download failed with HTTP ${response.status}.`);
  return response;
}

export async function deleteObject(key: string) {
  const response = await storageRequest('DELETE', key);
  if (!response.ok && response.status !== 404) {
    throw new Error(`Object deletion failed with HTTP ${response.status}.`);
  }
}

export async function deleteObjects(keys: Iterable<string>) {
  await Promise.all([...new Set(keys)].map((key) => deleteObject(key)));
}
