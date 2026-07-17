import assert from 'node:assert/strict';
import test from 'node:test';
import { resourcePartRanges } from '../src/lib/client/resource-upload';
import {
  assertAttachmentAllowedOnBoard,
  multipartUploadMetadata,
  parseMultipartUploadMetadata,
  resourcePartCount,
} from '../src/lib/server/multipart-upload';
import { presignObjectRequest } from '../src/lib/server/object-storage';

const MIB = 1024 * 1024;

test('500 MiB resources split into bounded 8 MiB parts', () => {
  const ranges = resourcePartRanges(500 * MIB, 8 * MIB);
  assert.equal(ranges.length, 63);
  assert.equal(resourcePartCount(500 * MIB), 63);
  assert.deepEqual(ranges[0], { partNumber: 1, start: 0, end: 8 * MIB });
  assert.deepEqual(ranges.at(-1), {
    partNumber: 63,
    start: 496 * MIB,
    end: 500 * MIB,
  });
});

test('multipart state round-trips and rejects malformed metadata', () => {
  const metadata = multipartUploadMetadata('upload+id/with-symbols', new Date('2026-07-17T00:00:00Z'));
  assert.deepEqual(parseMultipartUploadMetadata(JSON.stringify(metadata)), metadata);
  assert.equal(parseMultipartUploadMetadata('{"uploadId":"x","partSize":1}'), null);
});

test('resource-scoped and over-20 MiB attachments cannot bind to another board', () => {
  assert.doesNotThrow(() => assertAttachmentAllowedOnBoard('resources', [{
    storageKey: 'clean/resources/2026/07/17/user/file',
    sizeBytes: 500 * MIB,
  }]));
  assert.throws(
    () => assertAttachmentAllowedOnBoard('free', [{
      storageKey: 'clean/resources/2026/07/17/user/file',
      sizeBytes: 8 * MIB,
    }]),
    (error: unknown) => typeof error === 'object' && error !== null
      && 'code' in error && error.code === 'RESOURCE_ATTACHMENT_BOARD_REQUIRED',
  );
});

test('presigned object URLs bind the HTTP method, host, path, upload and expiry', () => {
  process.env.S3_ACCESS_KEY = 'test-access';
  process.env.S3_SECRET_KEY = 'test-secret';
  process.env.S3_BUCKET = 'igwak-uploads';
  process.env.S3_REGION = 'auto';
  const now = new Date('2026-07-17T00:00:00Z');
  const key = 'quarantine/resources/2026/07/17/user/file';
  const put = new URL(presignObjectRequest('PUT', key, 'https://ishsoutside.com', {
    expiresSeconds: 900,
    now,
    query: { partNumber: '1', uploadId: 'upload+id/value' },
  }));
  const get = new URL(presignObjectRequest('GET', key, 'https://ishsoutside.com', {
    expiresSeconds: 900,
    now,
    query: { partNumber: '1', uploadId: 'upload+id/value' },
  }));

  assert.equal(put.origin, 'https://ishsoutside.com');
  assert.equal(put.pathname, `/igwak-uploads/${key}`);
  assert.equal(put.searchParams.get('partNumber'), '1');
  assert.equal(put.searchParams.get('uploadId'), 'upload+id/value');
  assert.equal(put.searchParams.get('X-Amz-Expires'), '900');
  assert.match(put.searchParams.get('X-Amz-Signature') || '', /^[a-f0-9]{64}$/);
  assert.notEqual(put.searchParams.get('X-Amz-Signature'), get.searchParams.get('X-Amz-Signature'));
  assert.ok(
    put.search.indexOf('X-Amz-Algorithm=') < put.search.indexOf('partNumber='),
    'SigV4 canonical query parameters use bytewise ASCII ordering',
  );
});
