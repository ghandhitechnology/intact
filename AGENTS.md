# AGENTS.md

이 파일은 AI 코딩 에이전트가 인텍트 저장소에서 작업할 때 필요한 프로젝트 지식을 정리한 기준 문서입니다. 이 저장소의 문서·UI·커밋 메시지는 한국어를 사용합니다.

## 1. 프로젝트 개요

인텍트(Intact)는 인천과학고 재학생을 위한 비공개 생활 포털입니다.

- 운영 주소: `https://ishsoutside.com` (www는 본 도메인으로 영구 리디렉션)
- 저장소: `ghandhitechnology/intact`
- 주요 기능: 질문·대회 모집·자료·자유·공지·사진 게시판, 게시글 임시저장·수정 이력·댓글·추천·북마크·통합 검색, private MinIO 기반 첨부 파일, 1:1·그룹 메시지(Socket.IO 실시간), 알림·Web Push PWA, 활동 보상 IGK·상점·레벨, 학생 초대·가입·재인증, 관리자 대시보드(신고·제재·공지·사용자·초대·감사 로그), 이중망 게시물 모더레이션, B-side 전역 익명 모드.
- 참고 문서: `ARCHITECTURE.md`(런타임 경계·데이터 흐름), `DEPLOYMENT_HANDOVER.md`(운영 전체 절차), `FAST_DEPLOY.md`(배포·장애 런북), `MODERATION.md`(모더레이션 운영), `STABILITY_REPORT.md`(안정성 기준).

### 레거시 식별자와 리브랜딩

사용자 표시명은 `인텍트`이지만, 아래 낡은 식별자는 운영 DB·Docker 볼륨·보상 단위와의 호환을 위해 의도적으로 유지합니다. 임의로 바꾸면 Docker가 빈 볼륨을 만들거나 앱이 다른 DB를 가리킬 수 있으므로, 이름 변경은 데이터 migration으로 다룹니다.

- Compose 프로젝트: `igwak-portal`
- PostgreSQL 기본 DB/user: `igwak`, Docker 볼륨 prefix: `igwak-portal_`
- 보상 단위: `IGK`
- 서버 디렉터리: `/opt/ishsoutside`

## 2. 저장소 구조

npm workspace가 아닌 디렉터리별 독립 lockfile을 가진 모노레포입니다.

```text
.
├── client/                  Next.js 15 Web UI + REST API + Prisma + PWA + 워커 스크립트
│   ├── src/app/             페이지와 api/**/route.ts (App Router)
│   ├── src/lib/server/      세션, 암호화, HTTP 검증, 스토리지, 도메인 로직
│   ├── src/lib/client/      브라우저 요청 계층 (12초 timeout, AbortController)
│   ├── src/lib/student-code.ts  학번 형식 검증의 단일 기준
│   ├── src/components/      community(커뮤니티), operations(인증), portal(레이아웃) 등
│   ├── prisma/              schema.prisma(모델 35개)와 순차 migrations
│   ├── scripts/             attachment-worker, moderation-worker, outbox-worker 등 tsx 워커
│   ├── tests/               node:test 기반 단위·계약 테스트 (*.test.ts)
│   └── public/sw.js         PWA service worker
├── server/chat/             Socket.IO 실시간 게이트웨이 (TypeScript → tsc → dist)
├── server/codex-moderation/ Codex 기반 게시물 검사 사이드카 (Node.js .mjs, npm 사용)
├── server/riro-bridge/      리로스쿨 인증 브리지 (Python FastAPI, Tailscale 전용 Mac mini)
├── deploy/                  backup-production.sh, systemd unit, sshd/fail2ban 설정
├── scripts/                 verify.sh(통합 검증 게이트), check-migrations.sh, stress-readonly.mjs
├── design/                  보관된 프로토타입. 운영에서 로드하지 않음
├── docker-compose.yml       전체 운영 스택 (프로젝트명 igwak-portal)
├── Caddyfile                TLS, /socket.io 프록시, 서명 object 전송
└── .env.example             운영 환경변수 템플릿 (client/.env.example은 Web 직접 실행용)
```

## 3. 기술 스택

| 영역 | 구성 |
| --- | --- |
| Web/UI/API | Next.js 15.5 App Router, React 18, TypeScript 5(strict), Tailwind CSS 3 |
| 데이터 | PostgreSQL 16, Prisma 5 |
| 실시간 | Socket.IO 4, Redis (adapter fan-out, rate limit, 단기 상태; compose는 digest 고정 이미지) |
| 파일 | MinIO/S3 호환 private bucket, ClamAV 검사, sharp 이미지 처리 |
| 모더레이션 | `@openai/codex` 0.144.5, 고정 모델 `gpt-5.6-luna`, Tesseract OCR(kor/eng) |
| 프록시/TLS | Caddy 2 |
| 실행 | Docker Compose v2, Node.js 22, Yarn 1.22.22 (corepack) |
| 브리지 | Python 3.11+ FastAPI + uvicorn (riro-bridge) |

## 4. 런타임 구조

Caddy만 인터넷 80/443을 받습니다.

- `/socket.io/*` → `realtime:3001` (Socket.IO 게이트웨이)
- `/{S3_BUCKET}/*` 의 GET/HEAD/PUT(요청당 10MB 상한) → `minio:9000` (서명 URL 전용)
- 나머지(본문 25MB 상한) → `web:3000` (Next.js)
- Web·realtime·MinIO 콘솔은 `127.0.0.1`에만 바인딩되며 직접 공개하지 않습니다.

Compose 서비스: `caddy`, `web`, `migrate`(일회성 `prisma migrate deploy`), `realtime`, `postgres`, `redis`, `minio`, `minio-init`(bucket 생성·공개 차단), `attachment-worker`(격리 object ClamAV 스트리밍 검사·승격·미완료 multipart 회수), `outbox-worker`(실시간 이벤트·Web Push 전달), `moderation-worker`(게시물 검사), `codex-moderation`, `clamav`, `platform-alias-backfill`·`codex-auth`(`tools` profile 일회성).

데이터 기준:

- PostgreSQL이 사용자·게시글·메시지·알림·IGK·운영 기록의 원본입니다. 메시지 원본도 PostgreSQL이며 Redis는 fan-out 전용입니다.
- MinIO object는 private입니다. Web이 권한을 확인하고 5분짜리 method/path-bound 서명 URL만 발급합니다.
- realtime gateway는 자체 사용자 DB를 만들지 않고 `INTERNAL_API_SECRET`으로 Web의 authorize API를 호출해 session/room을 검증합니다.

## 5. 개발 환경 요구 사항

- Node.js 22 — `.nvmrc`, `engines: >=22 <23`, `scripts/verify.sh`, Dockerfile이 모두 22를 강제합니다. (README의 "Node.js 20" 표기는 오래된 정보입니다.)
- Yarn 1.22.22 — `corepack enable && corepack prepare yarn@1.22.22 --activate`
- Python 3.11+ — riro-bridge 검증용 (CI는 3.12)
- Docker Engine + Compose v2 — 전체 스택 실행용

## 6. 빌드와 실행

### 전체 스택 (Docker)

```bash
cp .env.example .env        # 모든 replace-* 값을 서로 다른 난수로 교체 (openssl rand -hex 32)
docker compose config --quiet
docker compose up -d --build postgres redis minio minio-init migrate web realtime
```

Web `http://localhost:3000`, realtime `http://localhost:3001`, MinIO console `http://localhost:9001`. `caddy`는 실제 도메인 TLS용이므로 로컬에서는 생략 가능합니다.

### 소스 직접 실행

```bash
cd client
corepack yarn install --frozen-lockfile
corepack yarn prisma generate
corepack yarn prisma migrate deploy
corepack yarn dev

cd server/chat              # 다른 터미널
corepack yarn install --frozen-lockfile
corepack yarn dev           # tsc --watch + nodemon dist/index.js
```

의존 서비스(PostgreSQL, Redis, MinIO)와 환경변수가 실제로 접근 가능해야 합니다. 운영 `.env`를 개발 장비에 복사하지 않습니다.

## 7. 검증과 테스트

### 통합 검증 게이트 (CI와 동일)

```bash
bash scripts/verify.sh
```

`client/`에서 `corepack yarn verify`로도 실행됩니다. Node.js 22가 아니면 즉시 실패합니다. 순서: Prisma schema validate → migration 레이아웃 검사(`scripts/check-migrations.sh`, `DATABASE_URL`이 있으면 deploy까지) → client lint → `next typegen` → typecheck → client 테스트 → Next production build → realtime `tsc` build → codex-moderation `.mjs` 구문 검사(`node --check`) → riro-bridge 임시 venv 생성·`pip check`·`python -m unittest -v test_main.py`.

CI(`.github/workflows/verify.yml`)는 PR과 main push에서 PostgreSQL 16 서비스를 띄우고 이 스크립트를 그대로 실행합니다.

### 패키지별 명령

```bash
cd client
corepack yarn lint            # eslint . --max-warnings=0 (경고도 실패)
corepack yarn typecheck       # tsc --noEmit --incremental false
corepack yarn test            # tsx --test tests/*.test.ts
corepack yarn prisma:validate
corepack yarn build

cd server/chat
corepack yarn build           # tsc
```

테스트 전략:

- `client/tests/*.test.ts`는 `node:test` + `assert/strict` + `tsx`로 실행하는 단위·계약 테스트입니다. 외부 DB·네트워크 없이 동작하며, 필요한 환경변수는 각 테스트가 설정하고 복원합니다. API envelope 파싱, 보안 경계, IGK/상점, 첨부 lifecycle, 모더레이션 상태, 라우트 회귀 계약 등을 다룹니다.
- `server/riro-bridge/test_main.py`는 stdlib `unittest`입니다. 반드시 별도 venv에 `requirements.txt`(버전 고정)를 설치해 실행합니다.
- `server/codex-moderation`의 `npm run probe`·`security-probe`는 실제 모델 호출이므로 승인된 경우에만 실행합니다.
- 로컬 HTTP 표면 검증 절차는 `.claude/skills/verify/SKILL.md`에 있습니다. 운영 자격증명·DB·콘텐츠는 로컬 검증에 사용하지 않습니다.

## 8. 코드 스타일과 규칙

- TypeScript `strict`, ESLint는 `next/core-web-vitals` 하나만 확장하며 `--max-warnings=0`입니다.
- 경로 별칭: `@/*` → `client/src/*`.
- API 응답 규약은 `client/src/lib/server/http.ts`가 만듭니다: 성공 `{ ok: true, data }`, 실패 `{ ok: false, error: { code, message, details? } }`. `json()`/`jsonError()`와 `ApiError`를 사용하고, 모든 JSON 응답에 `Cache-Control: no-store`와 `X-Request-ID`가 붙으며 429에는 `Retry-After`가 붙습니다. 이 envelope를 우회해 응답을 만들지 않습니다.
- Route handler는 공통 helper로 입력 크기·타입, same-origin, rate limit, session scope를 검증합니다. 포털 API와 관리자 API는 별도 session scope를 사용합니다.
- 학번 검증의 단일 기준은 `client/src/lib/student-code.ts`와 `client/src/lib/server/student-invites.ts`입니다: `^(31|32|33)(11|12|13|14)(0[1-9]|1[0-9]|20)$`. DB에도 같은 CHECK와 unique(`User.loginId`, `StudentIdentity.studentCode`)가 있고, 가입은 serializable transaction에서 `P2034` 충돌만 최대 3회 재시도, unique 충돌은 HTTP 409입니다.
- `studentCode`는 기수와 입학 당시 1학년 반·번호를 합친 불변 로그인 ID이고, 재학 중 바뀌는 현재 학년·반·번호는 `currentStudentNumber`에 별도로 저장합니다. 리로 브리지 contract v2도 두 값을 분리합니다.
- IGK 잔액 변경은 반드시 transaction과 lock 안에서 `IgkLedger` 원장을 통해 수행합니다(`awardIgk` 등). `User.currentIgk`를 직접 덮어쓰거나 UI 값만 수정하지 않습니다. 채팅 전송·선물처럼 재시도가 있는 경로는 idempotency key로 중복 생성을 막습니다.
- B-side(전역 익명 모드) 마스킹은 서버의 API 응답에서 수행합니다. 화면에서만 가리는 구현으로 되돌리면 안 됩니다. 본인 정보와 관리자 scope 응답은 실명을 유지합니다.
- 세션은 DB에 저장되고 HttpOnly cookie로 전달됩니다. 관리자 변경 사항은 `AdminAuditLog`에 사유와 함께 기록합니다.
- 사용자 데이터는 service worker·공유 HTTP cache에 저장하지 않고, 홈·최근 대화 캐시는 `intact_cache_scope`로 분리된 `sessionStorage`만 사용합니다.
- 프런트엔드 디자인 시스템의 기준은 `client/src/app/globals.css`입니다: 색상·그림자(`--shadow-xs/sm/md/lg`)·모션(`--ease-out` `cubic-bezier(0.22,1,0.36,1)`, `--ease-spring`) 토큰과 진입 애니메이션(`.anim-rise/.anim-fade/.anim-pop`, `.stagger`), 로딩 시머(`.skeleton`)를 제공합니다. 공용 UI primitive는 `client/src/components/operations/ui.tsx`(Button·Input·Card·Modal·Tabs·Stat 등)와 `client/src/components/community/CommunityUI.tsx`이며, 새 화면은 이들을 조합해 만듭니다. 로딩 블록에 `animate-pulse`를 쓰지 않고 `.skeleton`을, 목록 진입에는 첫 마운트에만 `.stagger`를 적용합니다(폴링·페이지네이션에서 재생되지 않게 게이트).

## 9. 데이터 모델 변경 절차

1. `client/prisma/schema.prisma` 수정
2. 개발 DB 기준 새 migration 생성
3. 생성 SQL과 기존 데이터 호환성 검토
4. lint·typecheck·build·임시 DB migration 검증
5. production 백업
6. `prisma migrate deploy`
7. health와 영향 경로 확인

- 운영에서 `prisma db push`를 사용하지 않습니다. column drop/rename, 대량 backfill, enum 변경은 별도 maintenance·rollback 계획이 필요합니다.
- migration 디렉터리 이름은 `YYYYMMDDHHMMSS_설명` 형식이고 `migration.sql`만 포함해야 합니다(`scripts/check-migrations.sh`가 검증). `migration_lock.toml`은 `provider = "postgresql"`을 유지합니다.

## 10. 보안 고려 사항

- `.env`, 개인키, DB dump, SQLite 파일, 첨부 파일, backup archive를 Git에 올리지 않습니다(`.gitignore` 참조). `.gitleaksignore`가 있습니다.
- `.env.example`의 모든 `replace-*` 값은 서로 다른 난수(최소 32바이트)로 바꾸고, 로컬이라도 운영 비밀값을 복사하지 않습니다.
- `PORTAL_ENCRYPTION_KEY`는 실명 등 개인정보 복호화에 필요하므로 별도 비밀 저장소에 백업하고 무계획하게 회전하지 않습니다. B-side 익명 해시의 HMAC 키로도 사용됩니다.
- 운영에서 `PORTAL_DEMO_MODE`와 `NEXT_PUBLIC_PORTAL_DEMO_MODE`는 반드시 `false`입니다.
- MinIO bucket과 Web/realtime 포트는 공개하지 않습니다. 다운로드는 5분 서명 URL 경유, 대용량 본문은 Web을 통과하지 않습니다.
- `next.config.js`의 보안 header·CSP(`default-src 'self'` 등)와 Caddy의 본문 크기 상한(object 10MB, 앱 25MB)을 유지합니다.
- riro-bridge는 Tailscale IP에만 바인딩되는 비공개 서비스입니다. `RIRO_BRIDGE_SECRET`은 독립된 64자리 hex 난수이고, 리로스쿨 자격증명은 메모리에서만 사용하며 로그·저장하지 않습니다. 가입·재인증·비밀번호 복구는 직접 리로 인증을 기본으로 하고, 목적이 고정된 관리자 코드는 재인증·복구의 비상 대체 경로로만 사용합니다.
- codex-moderation은 공개 포트·DB URL·MinIO 자격증명·소스 mount를 갖지 않습니다. OAuth 토큰 볼륨(`codex_auth`)은 `codex-auth`·`codex-moderation`에만 연결됩니다.
- 관리자와 포털 세션/cookie는 분리되어 있으며 이 구조를 유지합니다.

## 11. 배포

- 운영: Hostinger VPS(Ubuntu 24.04), 서버 경로 `/opt/ishsoutside`, Compose 프로젝트 `igwak-portal`. SSH는 전용 배포 키(`~/.ssh/ishsoutside_deploy`)만 사용합니다.
- 배포 절차의 기준 문서: `DEPLOYMENT_HANDOVER.md`(전체·복구), `FAST_DEPLOY.md`(변경 범위별 A: Web만 / B: Web+realtime / C: migration 포함 / D: 인프라·env 경로 선택). migration이 포함되면 백업이 필수입니다.
- 백업: `deploy/backup-production.sh` + `ishsoutside-backup.service`/`.timer`(systemd), 위치 `/var/backups/ishsoutside`.
- 배포 후 `/api/health`, realtime `/health`, 로그인, 글·첨부·메시지·알림 경로를 실제 환경에서 확인합니다.

## 12. 문서 갱신 규칙

- API 경계나 서비스 구성이 바뀌면 `ARCHITECTURE.md`를, 도메인·서버·볼륨·배포·백업 절차가 바뀌면 `DEPLOYMENT_HANDOVER.md`를 같은 변경 세트에서 갱신합니다.
- 이 `AGENTS.md`도 명령·구조·규칙이 바뀌면 함께 갱신합니다.
