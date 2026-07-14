import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';

const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

export function looksLikePlaceholderSecret(value: string) {
  return /(?:replace|change|changeme|example|placeholder|development-secret)/i.test(value);
}

function secretMaterial() {
  const value = process.env.NODE_ENV === 'production'
    ? process.env.PORTAL_ENCRYPTION_KEY
    : process.env.PORTAL_ENCRYPTION_KEY || process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET;
  if (
    value &&
    value.length >= 32 &&
    (process.env.NODE_ENV !== 'production' || !looksLikePlaceholderSecret(value))
  ) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PORTAL_ENCRYPTION_KEY must be a non-placeholder secret of at least 32 characters.');
  }
  return 'igwak-local-development-secret-change-before-production';
}

function deriveKey() {
  return createHash('sha256').update(secretMaterial(), 'utf8').digest();
}

function runScrypt(password: string, salt: Buffer, n = SCRYPT_N) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: n, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await runScrypt(password, salt);
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, nText, rText, pText, saltText, hashText] = encoded.split('$');
  if (
    algorithm !== 'scrypt' ||
    !nText ||
    Number(rText) !== SCRYPT_R ||
    Number(pText) !== SCRYPT_P ||
    !saltText ||
    !hashText
  ) {
    return false;
  }

  const n = Number(nText);
  if (!Number.isInteger(n) || n < 16_384 || n > 131_072) return false;

  try {
    const expected = Buffer.from(hashText, 'base64url');
    const actual = await runScrypt(password, Buffer.from(saltText, 'base64url'), n);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function secureStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function privateFingerprint(value: string) {
  return createHmac('sha256', secretMaterial())
    .update(value.normalize('NFKC').trim().toLowerCase(), 'utf8')
    .digest('hex');
}

export function encryptText(plainText: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptText(encoded: string) {
  const [version, ivText, tagText, encryptedText] = encoded.split('.');
  if (version !== 'v1' || !ivText || !tagText || encryptedText === undefined) {
    throw new Error('Unsupported encrypted value.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(),
    Buffer.from(ivText, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function decodeBase32(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = value.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) return Buffer.alloc(0);
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totpAt(secret: Buffer, counter: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(buffer).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotp(base32Secret: string, submittedCode: string) {
  if (!/^\d{6}$/.test(submittedCode)) return false;
  const secret = decodeBase32(base32Secret);
  if (secret.length < 10) return false;
  const counter = Math.floor(Date.now() / 30_000);
  return [-1, 0, 1].some((window) => {
    const expected = Buffer.from(totpAt(secret, counter + window));
    const actual = Buffer.from(submittedCode);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
}
