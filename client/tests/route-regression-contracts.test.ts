import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

function compact(value: string) {
  return value.replace(/\s+/g, ' ');
}

test('message create route binds idempotency replays to a canonical request hash', () => {
  const route = source('src/app/api/messages/route.ts');
  assert.match(route, /messageRequestHash\s*\(/, 'route must compute the public canonical request hash');
  assert.match(route, /requestHash/, 'message persistence must store and compare the request hash');
  assert.match(route, /IDEMPOTENCY_(?:KEY_)?(?:CONFLICT|REUSED)/, 'same key with a different request must return a conflict');
  assert.match(route, /chatMessageEnvelope\s*\(/, 'new and replayed requests must retain one response envelope');
});

test('message list route uses a lossless cursor and deterministic ordering', () => {
  const route = compact(source('src/app/api/messages/route.ts'));
  assert.match(route, /parseChatCursor\s*\(/);
  assert.match(route, /sequenceCursor\s*\(/);
  assert.match(route, /legacyTimestampOrder[\s\S]*\[\{ createdAt: 'desc' \}, \{ id: 'desc' \}\][\s\S]*\[\{ sequence: 'desc' \}\]/);
  assert.match(route, /sequence:\s*\{\s*lt:/, 'strict-before sequence pagination prevents duplicates');
});

test('message read acknowledgements update sequence monotonically', () => {
  const route = compact(source('src/app/api/messages/route.ts'));
  assert.match(route, /lastReadSequence/);
  assert.match(route, /monotonicReadSequence|lastReadSequence:\s*\{\s*lt:/);
  assert.match(route, /messageId[^}]*roomId|roomId[^}]*messageId/, 'the acknowledged message must belong to the requested room');
});

test('chat unread aggregation casts request identifiers to PostgreSQL uuid', () => {
  const route = compact(source('src/app/api/chat/rooms/route.ts'));
  assert.match(route, /membership\."userId"\s*=\s*\$\{session\.user\.id\}::uuid/);
  assert.match(route, /message\."senderId"\s*<>\s*\$\{session\.user\.id\}::uuid/);
});

test('chat room membership writes stay owner-gated and capacity-bound', () => {
  const members = compact(source('src/app/api/chat/rooms/[id]/members/route.ts'));
  const room = compact(source('src/app/api/chat/rooms/[id]/route.ts'));
  assert.match(members, /NOT_ROOM_OWNER/);
  assert.match(members, /assertRoomCapacity/);
  assert.match(room, /notificationsMuted/);
  assert.match(room, /DIRECT_TITLE/);
});

test('signed-out home never loads or retains authenticated home data', () => {
  const home = compact(source('src/components/community/HomePage.tsx'));
  const shell = compact(source('src/components/portal/PortalShell.tsx'));
  assert.match(home, /sessionLoading \|\| !authenticated\) return undefined/);
  assert.match(home, /homeCacheKey = `\/api\/home:\$\{session\?\.user\?\.id/);
  assert.match(home, /setHomePayload\(null\)/);
  assert.match(home, /if \(!authenticated\) return <SignedOutHome/);
  assert.match(shell, /portalNavigationAvailable = DEMO_MODE \|\| session\?\.authenticated === true/);
  assert.match(shell, /!isAdmin && portalNavigationAvailable/);
});

test('student verification UI keeps Riro as the direct path and administrator codes as fallback', () => {
  const register = compact(source('src/app/register/page.tsx'));
  const reverify = compact(source('src/app/reverify/page.tsx'));
  const reset = compact(source('src/app/reset-password/page.tsx'));
  const sessionProvider = compact(source('src/components/portal/SessionProvider.tsx'));
  const shell = compact(source('src/components/portal/PortalShell.tsx'));

  assert.match(register, /value=\{verification\.profile\.studentCode\} readOnly/);
  assert.doesNotMatch(register, /setStudentCode|normalizedStudentCode/);
  assert.match(register, /verificationTicket: verification\.verificationTicket, password/);

  assert.match(reverify, /'\/api\/auth\/riro\/reverify'[\s\S]*30_000/);
  assert.match(reverify, /'\/api\/auth\/reverify'[\s\S]*12_000/);
  assert.match(reverify, /긴급 관리자 코드/);
  assert.match(reverify, /'\/api\/auth\/logout'/);
  assert.match(reverify, /step: 'completion'; method: ReverifyMethod; verificationTicket: string/);
  assert.match(reverify, /completeReverification\(submitted\.verificationTicket, submitted\.method\)/);
  assert.match(reverify, /body\.error\.code === 'INVALID_TICKET'/);
  assert.match(reverify, /재인증 완료 다시 시도/);

  assert.match(reset, /'\/api\/auth\/riro\/reset-verify'[\s\S]*30_000/);
  assert.match(reset, /'\/api\/auth\/reset-password'[\s\S]*12_000/);
  assert.match(reset, /긴급 관리자 코드/);

  assert.match(sessionProvider, /kind: 'warning'; dueAt: string; requiredAt: string/);
  assert.match(sessionProvider, /kind: 'grace'; dueAt: string; requiredAt: string/);
  assert.match(sessionProvider, /reverification\?: ReverificationStatus/);
  assert.doesNotMatch(shell, /PortalSessionSnapshot|ReverificationStatus/);
  assert.match(shell, /requiredAt[\s\S]*접근이 제한됩니다/);
  assert.match(shell, /href="\/reverify"[\s\S]*지금 재인증/);
});

test('my page exposes the IGK dashboard on every layout', () => {
  const profile = compact(source('src/app/profile/page.tsx'));
  assert.match(profile, /href="\/igk"[^>]*>[\s\S]*?IGK 대시보드/);
  assert.match(profile, /aria-label=\{`IGK 대시보드 열기/);
});

test('platform mode is recoverable and demo mode is database independent', () => {
  const route = compact(source('src/app/api/platform/route.ts'));
  const provider = compact(source('src/components/portal/PlatformModeProvider.tsx'));
  assert.match(route, /process\.env\.PORTAL_DEMO_MODE === 'true'/);
  assert.match(route, /version: 'demo'/);
  assert.match(provider, /보안 설정을 확인할 수 없어요/);
  assert.match(provider, /onClick=\{\(\) => void refresh\(\)\}/);
  assert.match(provider, /다시 시도/);
  assert.match(provider, /window\.sessionStorage\.getItem/);
  assert.match(provider, /window\.sessionStorage\.setItem/);
  assert.match(provider, /catch \{ return null/);
});

test('health reports every required runtime dependency', () => {
  const route = compact(source('src/app/api/health/route.ts'));
  assert.match(route, /prisma\.\$queryRaw`SELECT 1`/);
  assert.match(route, /getRedisClient\(\)/);
  assert.match(route, /client\.ping\(\)/);
  assert.match(route, /health\.redis_unavailable/);
  assert.match(route, /status: healthy \? 200 : 503/);
});

test('browser and proxy boundaries enforce baseline exploit mitigations', () => {
  const nextConfig = compact(source('next.config.js'));
  const caddy = compact(source('../Caddyfile'));
  const middleware = compact(source('src/middleware.ts'));
  assert.match(nextConfig, /Content-Security-Policy/);
  assert.match(nextConfig, /object-src 'none'/);
  assert.match(nextConfig, /frame-ancestors 'self'/);
  assert.match(nextConfig, /Referrer-Policy', value: 'no-referrer'/);
  assert.match(caddy, /max_size 25MB/);
  assert.match(caddy, /header_up X-Real-IP \{remote_host\}/);
  assert.match(middleware, /while \(adminVerifyCache\.size >= 100\)/);
  assert.match(middleware, /crypto\.subtle\.digest\('SHA-256'/);
});

test('report creation authorizes message targets and maps duplicate races consistently', () => {
  const route = compact(source('src/app/api/reports/route.ts'));
  assert.match(route, /reportLockKey\s*\(/);
  assert.match(route, /lockResources\s*\(/);
  assert.match(route, /message\.findFirst\s*\(/);
  assert.match(route, /members:\s*\{\s*some:\s*\{\s*userId:\s*session\.user\.id,\s*leftAt:\s*null/);
  assert.match(route, /isUniqueConstraintError\s*\(error\)/);
  assert.match(route, /ALREADY_REPORTED/);
});

test('post deletion is idempotent under races and scopes every IGK reversal to its source', () => {
  const route = compact(source('src/app/api/posts/[id]/route.ts'));
  assert.match(route, /post\.status === 'DELETED'[^;]*return json\(\{ deleted: true \}\)/);
  assert.match(route, /lockResources\(tx, \[`post:\$\{post\.id\}`\]\)/);
  assert.match(route, /!current \|\| current\.status === 'DELETED'[^;]*return/);
  assert.match(route, /originalIdempotencyKey:\s*`post:create:\$\{current\.id\}`/);
  assert.match(route, /idempotencyKey:\s*`post:delete:\$\{current\.id\}`/);
  assert.match(route, /idempotencyKey:\s*`recommendation:post-delete:\$\{recommendation\.id\}`/);
});

test('attachment creation quarantines pending files and consumers enforce readable clean state', () => {
  const upload = compact(source('src/app/api/uploads/route.ts'));
  const messages = compact(source('src/app/api/messages/route.ts'));
  const posts = compact(source('src/app/api/posts/route.ts'));
  const attachment = compact(source('src/app/api/uploads/[id]/route.ts'));

  assert.match(upload, /quarantineStorageKey\s*\(/);
  assert.match(upload, /scanStatus:\s*ATTACHMENT_STATUS\.PENDING/, 'uploads must not claim CLEAN before scanning');
  for (const [name, route] of [['messages', messages], ['posts', posts]] as const) {
    const helperAdopted = /bindEligibleAttachments\s*\(/.test(route);
    const directPredicate = /scanStatus:\s*(?:ATTACHMENT_STATUS\.CLEAN|'CLEAN')/.test(route)
      && /finalizedAt:\s*\{\s*not:\s*null\s*\}/.test(route)
      && /storageKey:\s*\{\s*startsWith:\s*'clean\/'\s*\}/.test(route);
    assert.equal(helperAdopted || directPredicate, true, `${name} must bind only finalized clean files`);
  }
  assert.match(attachment, /isReadableAttachment\(attachment\)/);
  assert.match(attachment, /serveDerivative = thumbnail && !legacyAttachment/);
});

test('attachment deletion cannot remove a file already bound to content', () => {
  const route = compact(source('src/app/api/uploads/[id]/route.ts'));
  assert.match(route, /select:\s*\{[^}]*postId:\s*true[^}]*messageId:\s*true|select:\s*\{[^}]*messageId:\s*true[^}]*postId:\s*true/);
  assert.match(route, /assertDeleteEligibleAttachment\s*\(/);
  assert.match(route, /attachmentObjectKeys\s*\(/);
});

test('object download timeout stops after response headers so streams can finish', () => {
  const storage = compact(source('src/lib/server/object-storage.ts'));
  assert.match(storage, /const responseTimeout = setTimeout\(\(\) => controller\.abort\(\), 30_000\)/);
  assert.match(storage, /return await fetch[\s\S]*finally \{ clearTimeout\(responseTimeout\)/);
  assert.doesNotMatch(storage, /AbortSignal\.timeout\(30_000\)/);
});

test('post updates adopt the public version precondition and atomic increment helpers', () => {
  const route = compact(source('src/app/api/posts/[id]/route.ts'));
  assert.match(route, /baseVersion\?:\s*unknown/);
  assert.match(route, /requestedPostVersion\(request, body\.baseVersion\)/);
  assert.match(route, /where:\s*\{\s*id,\s*version:\s*baseVersion\s*\}/);
  assert.match(route, /version:\s*\{\s*increment:\s*1\s*\}/);
  assert.match(route, /assertPostVersion\s*\(/);
});

test('outbox SQL identifiers remain compatible with the canonical Prisma model', () => {
  const runtime = source('src/lib/server/outbox.ts');
  const schema = source('prisma/schema.prisma');
  const model = schema.match(/model OutboxEvent \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(model, 'OutboxEvent model must exist');

  const referencedIdentifiers = ['topic', 'processedAt', 'failedAt', 'claimedAt', 'claimedBy'];
  for (const identifier of referencedIdentifiers) {
    if (!runtime.includes(`"${identifier}"`)) continue;
    assert.match(model, new RegExp(`\\n\\s+${identifier}\\s`), `outbox runtime references missing schema field ${identifier}`);
  }

  assert.match(runtime, /FOR UPDATE SKIP LOCKED/, 'claiming must prevent duplicate concurrent delivery');
  assert.match(runtime, /leaseExpiresAt/, 'claims must expire for crash recovery');
  assert.match(runtime, /attemptCount/, 'retry attempts must be persisted');
  assert.match(runtime, /lastError/, 'retry failures must be observable');
});

test('push subscription writes encrypt endpoint and browser keys on create and update', () => {
  const route = compact(source('src/app/api/notifications/push-subscriptions/route.ts'));
  assert.match(route, /const encryptedEndpoint = encryptText\(endpoint\)/);
  assert.match(route, /create:\s*\{[^}]*endpoint:\s*encryptedEndpoint[^}]*p256dh:\s*encryptedP256dh[^}]*auth:\s*encryptedAuth/);
  assert.match(route, /update:\s*\{[^}]*endpoint:\s*encryptedEndpoint[^}]*p256dh:\s*encryptedP256dh[^}]*auth:\s*encryptedAuth/);
});

test('realtime outbox integration avoids direct gateway double delivery', () => {
  const messageRoute = compact(source('src/app/api/messages/route.ts'));
  const gateway = compact(source('../server/chat/index.ts'));
  assert.match(messageRoute, /queueRealtimeEvent\s*\( tx, 'message'/);
  assert.match(messageRoute, /if \(!fromRealtimeGateway && !replayed\)/);
  assert.match(messageRoute, /'X-Realtime-Delivery': outboxPublicationEnabled\(\) \? 'outbox' : 'direct'/);
  assert.match(gateway, /response\.headers\.get\('x-realtime-delivery'\) === 'outbox'/);
  assert.match(gateway, /if \(!queuedForOutbox\) await emitMessageToRoom/);
});
