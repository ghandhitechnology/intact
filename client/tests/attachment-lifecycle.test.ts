import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import sharp from 'sharp';
import {
  ATTACHMENT_STATUS,
  AttachmentValidationError,
  assertDeleteEligibleAttachment,
  canTransitionAttachment,
  isBindEligibleAttachment,
  scanWithClamAv,
  validateAttachmentBytes,
} from '../src/lib/server/attachment-state';

async function withFakeClamAv(
  response: string,
  run: (port: number, received: () => Buffer) => Promise<void>,
) {
  let payload = Buffer.alloc(0);
  const server = net.createServer((socket) => {
    let buffered = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const commandLength = Buffer.from('zINSTREAM\0').byteLength;
      if (buffered.byteLength < commandLength || buffered.subarray(0, commandLength).toString() !== 'zINSTREAM\0') return;
      let offset = commandLength;
      const chunks: Buffer[] = [];
      while (buffered.byteLength >= offset + 4) {
        const length = buffered.readUInt32BE(offset);
        offset += 4;
        if (length === 0) {
          payload = Buffer.concat(chunks);
          socket.end(`${response}\0`);
          return;
        }
        if (buffered.byteLength < offset + length) return;
        chunks.push(buffered.subarray(offset, offset + length));
        offset += length;
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await run(address.port, () => payload);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('attachment lifecycle allows only explicit forward and cleanup transitions', () => {
  assert.equal(canTransitionAttachment(ATTACHMENT_STATUS.PENDING, ATTACHMENT_STATUS.PROCESSING), true);
  assert.equal(canTransitionAttachment(ATTACHMENT_STATUS.PROCESSING, ATTACHMENT_STATUS.PENDING), true);
  assert.equal(canTransitionAttachment(ATTACHMENT_STATUS.PROCESSING, ATTACHMENT_STATUS.CLEAN), true);
  assert.equal(canTransitionAttachment(ATTACHMENT_STATUS.CLEAN, ATTACHMENT_STATUS.PROCESSING), false);
  assert.equal(canTransitionAttachment(ATTACHMENT_STATUS.DELETING, ATTACHMENT_STATUS.CLEAN), false);
});

test('ClamAV INSTREAM FOUND response rejects EICAR content', async () => {
  const eicar = Buffer.from([
    'X5O!P%@AP[4\\PZX54(P^)7CC)7}$',
    'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  ].join(''));
  await withFakeClamAv('stream: Win.Test.EICAR_HDB-1 FOUND', async (port, received) => {
    const result = await scanWithClamAv(eicar, { host: '127.0.0.1', port, timeoutMs: 2_000 });
    assert.deepEqual(result, { status: 'INFECTED', signature: 'Win.Test.EICAR_HDB-1' });
    assert.deepEqual(received(), eicar);
  });
});

test('ClamAV INSTREAM OK response is accepted without faking CLEAN state', async () => {
  const content = Buffer.from('plain attachment');
  await withFakeClamAv('stream: OK', async (port) => {
    assert.deepEqual(
      await scanWithClamAv(content, { host: '127.0.0.1', port, timeoutMs: 2_000 }),
      { status: 'CLEAN' },
    );
  });
});

test('rejects MIME spoofing when declared image type differs from magic bytes', async () => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 4, background: '#ffffff' },
  }).png().toBuffer();
  await assert.rejects(
    validateAttachmentBytes({ bytes: png, declaredMimeType: 'image/jpeg' }),
    (error: unknown) => error instanceof AttachmentValidationError && error.code === 'MIME_MISMATCH',
  );
});

test('rejects corrupt images even when their magic bytes look valid', async () => {
  const corruptPng = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('not-a-valid-png'),
  ]);
  await assert.rejects(
    validateAttachmentBytes({ bytes: corruptPng, declaredMimeType: 'image/png' }),
    (error: unknown) => error instanceof AttachmentValidationError && error.code === 'INVALID_IMAGE',
  );
});

test('bind/delete race predicates never allow a deleting or bound file to cross', () => {
  const clean = {
    scanStatus: ATTACHMENT_STATUS.CLEAN,
    storageKey: 'clean/2026/07/17/user/file',
    finalizedAt: new Date(),
    postId: null,
    messageId: null,
  };
  assert.equal(isBindEligibleAttachment(clean), true);

  const deleteWon = { ...clean, scanStatus: ATTACHMENT_STATUS.DELETING };
  assert.equal(isBindEligibleAttachment(deleteWon), false);
  assert.equal(canTransitionAttachment(deleteWon.scanStatus, ATTACHMENT_STATUS.CLEAN), false);

  const bindWon = { ...clean, postId: 'post-id' };
  assert.throws(
    () => assertDeleteEligibleAttachment(bindWon),
    (error: unknown) => typeof error === 'object' && error !== null
      && 'status' in error && error.status === 409,
  );
});
