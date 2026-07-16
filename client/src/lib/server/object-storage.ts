import { createHash, createHmac } from 'crypto';

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

function encodedPath(bucket: string, key: string) {
  return `/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function storageRequest(
  method: 'GET' | 'PUT' | 'DELETE',
  key: string,
  options: { body?: Uint8Array; contentType?: string } = {},
) {
  const { endpoint, accessKey, secretKey, bucket, region } = config();
  const now = new Date();
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const payloadHash = hash(options.body ?? new Uint8Array());
  const path = `${endpoint.pathname.replace(/\/$/, '')}${encodedPath(bucket, key)}`;
  const headers: Record<string, string> = {
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': date,
  };
  if (options.contentType) headers['content-type'] = options.contentType;
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]?.trim()}\n`).join('');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaderNames.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, hash(canonicalRequest)].join('\n');
  const dateKey = hmac(`AWS4${secretKey}`, day);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`;

  const url = new URL(path, endpoint.origin);
  return fetch(url, {
    method,
    headers,
    body: options.body ? (options.body as BodyInit) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
}

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  const response = await storageRequest('PUT', key, { body, contentType });
  if (!response.ok) throw new Error(`Object upload failed with HTTP ${response.status}.`);
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
