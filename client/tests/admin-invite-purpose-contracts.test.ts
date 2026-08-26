import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminPage = readFileSync(
  new URL('../src/app/admin/page.tsx', import.meta.url),
  'utf8',
);

test('admin emergency-code creation selects and sends one explicit supported purpose', () => {
  for (const purpose of ['RESET', 'REVERIFY']) {
    assert.match(
      adminPage,
      new RegExp(`value: ["']${purpose}["']`),
      `${purpose} must be selectable`,
    );
  }

  assert.match(adminPage, /useState<InviteDraft>[\s\S]*?purpose:\s*"RESET"/);
  assert.match(adminPage, /function parseIssuableInvitePurpose\(value: string\): IssuableInvitePurpose \| null/);
  assert.doesNotMatch(adminPage, /event\.target\.value as InvitePurpose/);
  assert.match(
    adminPage,
    /<Select[\s\S]*?value=\{inviteDraft\.purpose\}[\s\S]*?required[\s\S]*?<\/Select>/,
  );
  assert.match(
    adminPage,
    /JSON\.stringify\(\{[\s\S]*?purpose:\s*inviteDraft\.purpose/,
  );
  assert.doesNotMatch(adminPage, /\/api\/admin\/invites\?purpose=REGISTER/);
});

test('legacy registration codes remain visible but cannot be issued or claimed', () => {
  const createRoute = readFileSync(
    new URL('../src/app/api/admin/invites/route.ts', import.meta.url),
    'utf8',
  );
  const verifyRoute = readFileSync(
    new URL('../src/app/api/auth/invite/verify/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(adminPage, /REGISTER:[\s\S]*?과거 발급 기록/);
  assert.match(createRoute, /purpose === 'REGISTER'[\s\S]*?'RIRO_REQUIRED'/);
  assert.match(verifyRoute, /purpose === 'REGISTER'[\s\S]*?'RIRO_REQUIRED'/);
  assert.match(createRoute, /currentStudentNumber: identity\.currentStudentNumber/);
  assert.match(createRoute, /grade: identity\.grade/);
});

test('admin invite surfaces identify purpose in list and detail views', () => {
  assert.match(adminPage, /invitePurposeBadge\(invite\.purpose\)/);
  assert.match(adminPage, /invitePurposeBadge\(createdInvite\.invite\.purpose\)/);
  assert.match(adminPage, /invitePurposeBadge\(revokingInvite\.purpose\)/);
});
