import { randomUUID } from 'node:crypto';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  copyObject,
  createMultipartUpload,
  deleteObjects,
  headObject,
  presignMultipartPart,
  presignObjectRequest,
} from '../src/lib/server/object-storage';

const publicOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://ishsoutside.com').origin;
const id = randomUUID();
const quarantineKey = `quarantine/resources/smoke/${id}`;
const cleanKey = `clean/resources/smoke/${id}`;
const first = Buffer.alloc(8 * 1024 * 1024, 0x41);
const second = Buffer.from(`intact-resource-upload-smoke:${id}`, 'utf8');
let uploadId: string | null = null;

async function uploadPart(partNumber: number, bytes: Uint8Array) {
  if (!uploadId) throw new Error('Multipart upload was not initialized.');
  const url = presignMultipartPart(quarantineKey, uploadId, partNumber, publicOrigin, 300);
  const response = await fetch(url, { method: 'PUT', body: bytes as BodyInit });
  const etag = response.headers.get('etag');
  if (!response.ok || !etag) {
    const xml = await response.text();
    const code = xml.match(/<Code>([^<]{1,100})<\/Code>/)?.[1] || 'unknown';
    const message = xml.match(/<Message>([^<]{1,200})<\/Message>/)?.[1] || 'no message';
    throw new Error(`Signed part ${partNumber} failed with HTTP ${response.status}: ${code} (${message}).`);
  }
  return { partNumber, etag };
}

async function main() {
  let completed = false;
  try {
    uploadId = await createMultipartUpload(quarantineKey, 'application/octet-stream');
    const parts = [
      await uploadPart(1, first),
      await uploadPart(2, second),
    ];
    await completeMultipartUpload(quarantineKey, uploadId, parts);
    completed = true;

    const stored = await headObject(quarantineKey);
    if (stored.size !== first.byteLength + second.byteLength) {
      throw new Error(`Multipart size mismatch: ${stored.size}.`);
    }
    await copyObject(quarantineKey, cleanKey);
    const copied = await headObject(cleanKey);
    if (copied.size !== stored.size) throw new Error('Server-side promotion changed the object size.');

    const downloadUrl = presignObjectRequest('GET', cleanKey, publicOrigin, { expiresSeconds: 300 });
    const ranged = await fetch(downloadUrl, {
      headers: { Range: `bytes=${first.byteLength}-${stored.size - 1}` },
    });
    const downloaded = Buffer.from(await ranged.arrayBuffer());
    if (ranged.status !== 206 || !downloaded.equals(second)) {
      throw new Error(`Signed Range download failed with HTTP ${ranged.status}.`);
    }

    console.log(JSON.stringify({
      event: 'resource_upload_smoke_passed',
      multipartParts: parts.length,
      bytes: stored.size,
      rangeStatus: ranged.status,
    }));
  } finally {
    if (uploadId && !completed) {
      await abortMultipartUpload(quarantineKey, uploadId).catch(() => undefined);
    }
    await deleteObjects([quarantineKey, cleanKey]).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
