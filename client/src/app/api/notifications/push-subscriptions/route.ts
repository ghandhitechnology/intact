import prisma from '@/lib/prisma';
import { encryptText } from '@/lib/server/crypto';
import { ApiError, assertSameOrigin, json, jsonError, readJson, requiredString } from '@/lib/server/http';
import { pushEndpointHash } from '@/lib/server/notifications';
import { isTrustedPushEndpoint } from '@/lib/server/push-endpoint';
import { requireUser } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEY_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;

type SubscriptionBody = {
  endpoint?: unknown;
  expirationTime?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

function validEndpoint(value: unknown) {
  const endpoint = requiredString(value, '푸시 구독 주소', { max: 4_096 });
  if (!isTrustedPushEndpoint(endpoint)) {
    throw new ApiError(400, 'INVALID_PUSH_ENDPOINT', '신뢰할 수 있는 Web Push 서비스 주소만 사용할 수 있습니다.');
  }
  return endpoint;
}

function validKey(value: unknown, name: string, max: number) {
  const key = requiredString(value, name, { max });
  if (!KEY_PATTERN.test(key)) {
    throw new ApiError(400, 'INVALID_PUSH_KEY', `${name} 형식이 올바르지 않습니다.`);
  }
  return key;
}

function expirationDate(value: unknown) {
  if (value === undefined || value === null) return null;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) {
    throw new ApiError(400, 'INVALID_PUSH_EXPIRATION', '푸시 구독 만료 시간이 올바르지 않습니다.');
  }
  const expiresAt = new Date(timestamp);
  if (expiresAt <= new Date() || expiresAt.getTime() > Date.now() + 5 * 365 * 24 * 60 * 60 * 1_000) {
    throw new ApiError(400, 'INVALID_PUSH_EXPIRATION', '푸시 구독 만료 시간이 올바르지 않습니다.');
  }
  return expiresAt;
}

function pushConfigured() {
  const subject = process.env.VAPID_SUBJECT?.trim();
  return Boolean(
    process.env.VAPID_PUBLIC_KEY?.trim()
    && process.env.VAPID_PRIVATE_KEY?.trim()
    && subject
    && /^(?:mailto:|https:\/\/)/.test(subject),
  );
}

export async function GET(request: Request) {
  try {
    const session = await requireUser(request);
    const activeCount = await prisma.pushSubscription.count({
      where: {
        userId: session.user.id,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || null;
    return json({ configured: pushConfigured(), publicKey: pushConfigured() ? publicKey : null, subscribed: activeCount > 0, activeCount });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    if (!pushConfigured()) {
      throw new ApiError(503, 'PUSH_NOT_CONFIGURED', '푸시 알림을 아직 사용할 수 없습니다.');
    }
    const body = await readJson<SubscriptionBody>(request, 16_384);
    const endpoint = validEndpoint(body.endpoint);
    const endpointHash = pushEndpointHash(endpoint);
    const p256dh = validKey(body.keys?.p256dh, 'p256dh 키', 512);
    const auth = validKey(body.keys?.auth, 'auth 키', 256);
    const expiresAt = expirationDate(body.expirationTime);
    const encryptedEndpoint = encryptText(endpoint);
    const encryptedP256dh = encryptText(p256dh);
    const encryptedAuth = encryptText(auth);
    const subscription = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${endpointHash}), hashtext('push-subscription'))`;
      const existing = await tx.pushSubscription.findUnique({
        where: { endpointHash },
        select: { userId: true },
      });
      if (existing && existing.userId !== session.user.id) {
        throw new ApiError(409, 'PUSH_ENDPOINT_OWNED', '이미 다른 계정에 등록된 푸시 구독입니다.');
      }
      return tx.pushSubscription.upsert({
        where: { endpointHash },
        update: {
          endpoint: encryptedEndpoint,
          p256dh: encryptedP256dh,
          auth: encryptedAuth,
          expiresAt,
          revokedAt: null,
          failureCount: 0,
          lastFailureAt: null,
          userAgent: request.headers.get('user-agent')?.slice(0, 512) || null,
        },
        create: {
          userId: session.user.id,
          endpoint: encryptedEndpoint,
          endpointHash,
          p256dh: encryptedP256dh,
          auth: encryptedAuth,
          expiresAt,
          userAgent: request.headers.get('user-agent')?.slice(0, 512) || null,
        },
        select: { id: true, createdAt: true, updatedAt: true, expiresAt: true },
      });
    });
    return json({ subscription }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ endpoint?: unknown }>(request, 8_192);
    const endpoint = validEndpoint(body.endpoint);
    const result = await prisma.pushSubscription.updateMany({
      where: { userId: session.user.id, endpointHash: pushEndpointHash(endpoint), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return json({ unsubscribed: result.count > 0 });
  } catch (error) {
    return jsonError(error);
  }
}
