import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '@/lib/server/http';

export type CursorScalar = string | number | boolean | null;
export type CursorDirection = 'asc' | 'desc';

type CursorEnvelope = {
  v: 1;
  scope: string;
  position: CursorScalar[];
};

const MAX_CURSOR_LENGTH = 2_048;
const MAX_POSITION_LENGTH = 8;

function cursorSecret() {
  const secret = process.env.CURSOR_SECRET
    || process.env.SESSION_SECRET
    || process.env.PORTAL_ENCRYPTION_KEY;
  if (!secret || secret.length < 16) {
    throw new Error('CURSOR_SECRET, SESSION_SECRET, or PORTAL_ENCRYPTION_KEY must be at least 16 characters');
  }
  return secret;
}

function signature(encoded: string, secret: string) {
  return createHmac('sha256', secret).update(encoded).digest('base64url');
}

function invalidCursor(): never {
  throw new ApiError(400, 'INVALID_CURSOR', '페이지 커서가 올바르지 않거나 만료되었습니다.');
}

function validPosition(value: unknown): value is CursorScalar[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= MAX_POSITION_LENGTH
    && value.every((item) => (
      item === null
      || typeof item === 'boolean'
      || (typeof item === 'number' && Number.isFinite(item))
      || (typeof item === 'string' && item.length <= 512)
    ));
}

export function cursorScope(namespace: string, context: unknown) {
  const digest = createHash('sha256').update(JSON.stringify(context)).digest('base64url').slice(0, 22);
  return `${namespace}:${digest}`;
}

export function encodeCursor(
  scope: string,
  position: CursorScalar[],
  secret = cursorSecret(),
) {
  if (!scope || scope.length > 256 || !validPosition(position)) invalidCursor();
  const encoded = Buffer.from(JSON.stringify({ v: 1, scope, position } satisfies CursorEnvelope))
    .toString('base64url');
  return `${encoded}.${signature(encoded, secret)}`;
}

export function decodeCursor(
  token: string,
  expectedScope: string,
  secret = cursorSecret(),
): CursorScalar[] {
  if (!token || token.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    invalidCursor();
  }
  const [encoded, suppliedSignature] = token.split('.');
  if (!encoded || !suppliedSignature) invalidCursor();
  const expectedSignature = signature(encoded, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) invalidCursor();

  let envelope: unknown;
  try {
    envelope = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    invalidCursor();
  }
  if (
    !envelope
    || typeof envelope !== 'object'
    || (envelope as Partial<CursorEnvelope>).v !== 1
    || (envelope as Partial<CursorEnvelope>).scope !== expectedScope
    || !validPosition((envelope as Partial<CursorEnvelope>).position)
  ) {
    invalidCursor();
  }
  return (envelope as CursorEnvelope).position;
}

export function cursorDate(value: CursorScalar) {
  if (typeof value !== 'string') invalidCursor();
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) invalidCursor();
  return date;
}

export function cursorString(value: CursorScalar) {
  if (typeof value !== 'string' || !value) invalidCursor();
  return value;
}

export function cursorNumber(value: CursorScalar) {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalidCursor();
  return value;
}

export function cursorBoolean(value: CursorScalar) {
  if (typeof value !== 'boolean') invalidCursor();
  return value;
}

/** Returns true when a compound position belongs after the supplied cursor. */
export function isAfterCompoundCursor(
  position: CursorScalar[],
  cursor: CursorScalar[],
  directions: CursorDirection[],
) {
  if (position.length !== cursor.length || position.length !== directions.length) {
    throw new Error('Compound cursor shapes must match');
  }
  for (let index = 0; index < position.length; index += 1) {
    const left = position[index];
    const right = cursor[index];
    if (left === right) continue;
    if (left === null) return directions[index] === 'asc';
    if (right === null) return directions[index] === 'desc';
    if (typeof left !== typeof right) throw new Error('Compound cursor types must match');
    return directions[index] === 'asc' ? left > right : left < right;
  }
  return false;
}
