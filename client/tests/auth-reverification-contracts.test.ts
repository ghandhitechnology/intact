import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

function compact(value: string) {
  return value.replace(/\s+/g, ' ');
}

test('existing students receive the one-time Riroschool reverification flag', () => {
  const schema = source('prisma/schema.prisma');
  const migration = source('prisma/migrations/20260827000000_riro_reverification_flag/migration.sql');
  assert.match(schema, /requiresRiroReverification\s+Boolean\s+@default\(false\)/);
  assert.match(migration, /ADD COLUMN "requiresRiroReverification" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /SET "requiresRiroReverification" = true\s+WHERE "role" = 'USER'/);
});

test('login applies the one-time flag while active session resolution only applies annual hard expiry', () => {
  const login = compact(source('src/app/api/auth/login/route.ts'));
  const session = compact(source('src/lib/server/session.ts'));
  assert.match(login, /user\.requiresRiroReverification \|\| reverification\.kind === 'required'/);
  assert.doesNotMatch(session, /requiresRiroReverification/);
  assert.match(session, /getReverificationState\(session\.user\.reverifyDueAt, now\)\.kind === 'required'/);
});

test('session API exposes only the public reverification state', () => {
  const route = compact(source('src/app/api/auth/session/route.ts'));
  assert.match(route, /reverification: getPublicReverificationState\(session\.user\.reverifyDueAt\)/);
  assert.doesNotMatch(route, /requiresRiroReverification/);
});

test('direct Riroschool reverification binds the ticket to the signed-in identity', () => {
  const route = compact(source('src/app/api/auth/riro/reverify/route.ts'));
  assert.match(route, /assertSameOrigin\(request\)/);
  assert.match(route, /enforceDistributedClientIpRateLimit\(request, 'riro-reverify'/);
  assert.match(route, /enforceDistributedRateLimit\(`riro-reverify-account:/);
  assert.match(route, /verifyRiroAccount\(id, password\)/);
  assert.match(route, /const verifiedAccountFingerprint = riroAccountFingerprint\(id\)/);
  assert.match(route, /identity\.riroAccountFingerprint !== verifiedAccountFingerprint/);
  assert.match(route, /identity\.studentCode !== student\.studentCode/);
  assert.match(route, /isLegacySyntheticRiroFingerprint/);
  assert.match(route, /identity\.generation !== profile\.generation/);
  assert.match(route, /storedName !== verifiedName/);
  assert.match(route, /purpose: 'REVERIFY'/);
  assert.doesNotMatch(route, /studentInviteId:/);
});

test('Riroschool reset verification requires the stored account fingerprint', () => {
  const route = compact(source('src/app/api/auth/riro/reset-verify/route.ts'));
  assert.match(route, /findUnique\(\{ where: \{ riroAccountFingerprint: accountFingerprint \}/);
  assert.doesNotMatch(route, /requiresRiroReverification/);
  assert.match(route, /identity\.studentCode !== profile\.studentCode/);
  assert.match(route, /identity\.generation !== profile\.generation/);
  assert.match(route, /storedName !== verifiedName/);
});

test('reverification consumes either direct or invite tickets atomically', () => {
  const route = compact(source('src/app/api/auth/reverify/route.ts'));
  assert.match(route, /verificationTicket\.updateMany\(/);
  assert.match(route, /consumedTicket\.count !== 1/);
  assert.match(route, /identity\.riroAccountFingerprint !== ticket\.riroAccountFingerprint/);
  assert.match(route, /linksLegacyRiroAccount/);
  assert.match(route, /isLegacySyntheticRiroFingerprint/);
  assert.match(route, /if \(ticket\.studentInviteId\)/);
  assert.match(route, /requiresRiroReverification: false/);
  assert.match(route, /createPortalSession\([\s\S]*?session\.expiresAt/);
  assert.doesNotMatch(route, /관리자가 발급한 재인증 코드가 아닙니다/);
});

test('registration derives the student code from the verified ticket', () => {
  const route = compact(source('src/app/api/auth/register/route.ts'));
  assert.doesNotMatch(route, /body\.studentCode/);
  assert.doesNotMatch(route, /STUDENT_CODE_MISMATCH/);
  assert.match(route, /parseStudentCode\(preparedTicket\.studentCode\)/);
  assert.match(route, /loginId: ticket\.studentCode/);
  assert.match(route, /requiresRiroReverification: false/);
});

test('registration safely recovers a lost success response with ticket identity and password', () => {
  const route = compact(source('src/app/api/auth/register/route.ts'));
  assert.match(route, /if \(preparedTicket\.usedAt\)/);
  assert.match(route, /where: \{ riroAccountFingerprint: preparedTicket\.riroAccountFingerprint \}/);
  assert.match(route, /identity\.studentCode === preparedTicket\.studentCode/);
  assert.match(route, /identity\.nameFingerprint === preparedTicket\.nameFingerprint/);
  assert.match(route, /identity\.user\.role === 'USER'/);
  assert.match(route, /identity\.user\.status === 'ACTIVE'/);
  assert.match(route, /verifyPassword\(/);
  assert.match(route, /identityMatches && identity \? identity\.user\.passwordHash : await recoveryDummyHash/);
  assert.match(
    route,
    /if \(!identity \|\| !identityMatches \|\| !passwordMatches\) \{ throw new ApiError\(400, 'INVALID_TICKET'/,
  );
  assert.match(route, /createPortalSession\(identity\.user\.id, request\)/);
});

test('Riroschool client canonicalizes IDs and rejects unsafe bridge responses', () => {
  const runtime = compact(source('src/lib/server/riro.ts'));
  assert.match(runtime, /canonicalizeRiroId\(riroId\)/);
  assert.match(runtime, /\/\^\[0-9a-f\]\{64\}\$\//);
  assert.match(runtime, /redirect: 'error'/);
  assert.match(runtime, /role !== '학생'/);
  assert.match(runtime, /entryStudentNumber/);
  assert.match(runtime, /open-registration:\$\{studentCode\}/);
  assert.match(runtime, /student-code:\$\{studentCode\}/);
  assert.match(runtime, /studentCode: `\$\{String\(generation\)\.padStart\(2, '0'\)\}\$\{entryStudentNumber\}`/);
  assert.match(runtime, /MAX_BRIDGE_RESPONSE_BYTES/);
  assert.match(runtime, /\{ retryAfter: error\.retryAfter \}/);
});
