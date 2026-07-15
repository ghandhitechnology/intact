# 인텍트 시스템 구조

이 문서는 코드를 처음 보는 개발자가 서비스 경계와 데이터 흐름을 빠르게 파악하기 위한 설명입니다. 서버 주소, 배포 명령, 백업·복구 같은 운영 정보는 [DEPLOYMENT_HANDOVER.md](./DEPLOYMENT_HANDOVER.md)에 있습니다.

## 1. 런타임 구조

```text
Browser / installed PWA
        │ HTTPS + same-origin cookies
        ▼
      Caddy
        ├── /socket.io/* ──► Realtime gateway ──► Redis
        │                           │
        │                           └── internal authorization/API
        └── all other paths ─► Next.js Web/API ──► PostgreSQL
                                      │
                                      └──────────► private MinIO bucket
```

- Caddy만 인터넷의 80/443 포트를 받습니다.
- Web과 realtime은 VPS의 localhost 포트에도 바인딩되지만 직접 공개하지 않습니다.
- 브라우저가 사용하는 세션 cookie는 Web이 발급·검증합니다.
- PostgreSQL이 사용자, 게시글, 메시지, 알림, IGK와 운영 기록의 기준 데이터입니다.
- Redis는 realtime fan-out과 짧은 수명의 상태에 사용하며 영구 메시지 원본이 아닙니다.
- MinIO object는 private이며 Web의 권한 검사를 통과한 API로만 접근합니다.

## 2. Web 애플리케이션

`client/src/app`은 Next.js App Router 구조입니다.

- 페이지: 홈, 게시판, 글, 검색, 메시지, 알림, IGK, 프로필, 지원, 인증, 관리자
- API: 같은 디렉터리의 `api/**/route.ts`
- 공통 서버 로직: `client/src/lib/server`
- 포털 layout/navigation: `client/src/components/portal`
- 커뮤니티 UI: `client/src/components/community`
- 인증 UI: `client/src/components/operations`

Route handler는 입력 크기와 타입, same-origin, rate limit, session scope를 공통 helper로 검증합니다. 관리자 API와 일반 포털 API는 별도 session scope를 사용합니다.

브라우저의 주요 조회·저장 요청은 `client/src/lib/client/request.ts`의 12초 timeout과 `AbortController`를 사용합니다. 화면 전환으로 필요 없어진 요청은 취소하고, 오프라인·timeout·서버 실패와 실제 빈 결과를 서로 다른 상태로 표시합니다. 세션 API 장애는 미인증으로 간주하지 않으며, 명시적인 `authenticated: false` 응답만 로그인 화면 이동의 근거로 사용합니다.

## 3. 인증과 학생 계정

일반 사용자의 로그인 ID는 허용된 6자리 학번입니다.

```text
^(31|32|33)(11|12|13|14)(0[1-9]|1[0-9]|20)$
```

검증의 단일 기준은 `client/src/lib/student-code.ts`와 `client/src/lib/server/student-invites.ts`입니다. UI 검증은 안내를 빠르게 제공하기 위한 것이며, 최종 보안 경계는 API와 PostgreSQL 제약입니다.

- `User.loginId` unique
- `StudentIdentity.studentCode` unique
- 학번을 저장하는 표마다 동일한 DB CHECK
- 가입은 serializable transaction이며 `P2034` 충돌만 최대 3회 짧게 재시도
- unique conflict는 HTTP 409

세션은 DB에 저장되며 HttpOnly cookie로 전달됩니다. 포털과 관리자 session/cookie는 분리됩니다. `PORTAL_ENCRYPTION_KEY`는 실명처럼 복호화가 필요한 개인정보에 사용되므로 분실하거나 무계획하게 회전하면 안 됩니다.

## 4. 게시판과 첨부 파일

`Board` → `Post` → `Comment`가 기본 계층이며, 게시글에는 revision, recommendation, bookmark, report가 연결됩니다.

첨부 흐름:

1. 인증된 사용자가 업로드 API에 metadata를 제출합니다.
2. Web이 권한과 파일 제한을 확인하고 private MinIO bucket에 object를 저장합니다.
3. `Attachment`가 게시글과 연결됩니다.
4. 다운로드 요청 때 Web이 session과 연결 권한을 다시 확인합니다.
5. 게시글/첨부 삭제 시 DB와 object 정리가 함께 수행됩니다.

게시글은 최대 5개, 각 20MB 첨부를 허용합니다. 현재 별도 악성 파일 스캔은 없으므로 사용자가 내려받은 파일을 실행하지 않도록 운영 안내가 필요합니다.

게시된 글의 첨부는 모든 로그인 사용자가 열 수 있고, 메시지 첨부는 해당 대화방의 현재 참여자만 열 수 있습니다. 안전한 이미지·PDF·미디어 MIME은 기본적으로 브라우저에서 inline 표시하고 `?download=1`일 때 원본 다운로드를 강제합니다. HTML, SVG 등 실행 가능성이 있는 형식은 inline 표시하지 않습니다.

MinIO 내부 요청은 30초 뒤 중단되어 object storage 장애가 Web 요청을 무기한 점유하지 않게 합니다. 미리보기는 `X-Frame-Options: SAMEORIGIN` 범위에서만 iframe 표시를 허용하며 외부 사이트의 framing은 차단합니다.

`photos` 게시판은 같은 Post/Attachment 모델을 사용하지만 API에서 별도 불변 조건을 적용합니다. 본문과 태그는 저장하지 않고, 게시 시 JPG·PNG·GIF·WebP·AVIF 중 1~12장이 반드시 연결되어야 합니다. 클라이언트 MIME만 신뢰하지 않고 업로드 시 파일 signature를 확인합니다.

## 5. 메시지와 실시간 이벤트

브라우저는 먼저 Web API에서 대화방 목록과 최근 메시지를 읽고, Socket.IO 연결을 통해 새 메시지와 읽음 이벤트를 받습니다.

- gateway가 전달받은 session/room 정보를 Web 내부 API로 검증
- 메시지 원본은 PostgreSQL에 저장
- 최근 100개를 먼저 표시하고 이전 내역은 위쪽으로 추가 로딩
- 방 입장·전송은 최신 메시지로 이동
- 과거 내역을 읽는 중 새 메시지가 오면 위치를 유지하고 새 메시지 표시 제공
- 이전 내역 추가 시 사용자가 보던 화면 위치 유지

Realtime을 재시작해도 저장된 메시지는 PostgreSQL에서 복원됩니다. 장애 분석에서는 Web API, realtime gateway, Redis, `/socket.io/` 프록시를 각각 확인해야 합니다.

브라우저는 Socket.IO 연결 상태를 표시하고 연결이 끊기면 화면이 보이는 동안 45초 간격 조회로 보완합니다. gateway의 `/health`는 현재 연결 수를 반환하며 Compose healthcheck가 이 응답을 감시합니다. SIGTERM/SIGINT에서는 새 프로세스로 교체되기 전에 기존 연결을 닫습니다.

## 6. 알림, IGK와 운영 기능

알림 DB row는 개별 사건을 보존하고, UI가 metadata의 `postId`, `roomId`, 대상 ID를 사용해 관련 사건을 묶습니다. 그룹을 읽으면 기존 batch PATCH API에 읽지 않은 ID 목록을 전달합니다.

IGK는 `IgkLedger`가 원장이며 잔액, 선물, 활동 보상과 등급이 여기서 파생됩니다. 랭킹은 `User.currentIgk`, 등급은 활동 보상과 받은 선물을 합산한 `User.lifetimeIgk` 기준입니다. 선물을 보낸 사람의 누적 등급은 낮아지지 않고, 받은 사람은 수령액 전부가 등급 누적에 반영됩니다. 잔액 변경은 transaction과 lock을 사용해야 하며 UI 값만 수정해서는 안 됩니다.

등급은 내부 level 1–10을 사용자 화면에서 `9등급`, `8등급` … `1등급`, `선생님`으로 표시합니다. 기준값은 `client/src/lib/igk-levels.ts`와 `LevelRule`에 맞춰 관리하고 `/igk/roadmap`에서 전체 기준을 공개합니다.

관리자는 신고·제재·공지·사용자·초대·지원 요청을 처리합니다. 중요한 변경은 `AdminAuditLog`에 사유와 변경 내용을 기록합니다.

관리자의 IGK 지급·회수는 `User.currentIgk`를 직접 덮어쓰지 않고 계정 lock 안에서 증감합니다. 같은 transaction에서 `ADMIN_ADJUSTMENT` 원장, 사용자 알림, `USER_ADJUST_IGK` 감사 로그를 생성합니다. 활동으로 쌓인 `lifetimeIgk`와 레벨은 관리자의 단순 잔액 조정으로 바뀌지 않습니다.

## 7. 데이터 모델 변경

1. `client/prisma/schema.prisma` 수정
2. 개발 DB를 기준으로 새 migration 생성
3. 생성 SQL과 기존 데이터 호환성 검토
4. lint/typecheck/build와 임시 DB migration 검증
5. production 백업
6. `prisma migrate deploy`
7. health와 영향받는 사용자 경로 확인

운영에서 `prisma db push`를 사용하지 않습니다. column drop/rename, 대량 backfill, enum 변경은 별도 maintenance 및 rollback 계획이 필요합니다.

## 8. 내부 이름과 리브랜딩

사용자 표시명은 `인텍트`, GitHub 저장소명은 `intact`입니다. 아래 내부 이름은 기존 운영 데이터와의 호환성을 위해 의도적으로 남아 있습니다.

- Compose project: `igwak-portal`
- PostgreSQL 기본 DB/user: `igwak`
- Docker volume prefix: `igwak-portal_`
- 보상 단위: `IGK`
- 현재 도메인과 서버 디렉터리: `ishsoutside.com`, `/opt/ishsoutside`

내부 이름을 바꾸면 Docker가 빈 볼륨을 새로 만들거나 애플리케이션이 다른 DB를 가리킬 수 있습니다. 이름 변경은 데이터 migration으로 다룹니다.

## 9. 변경 시 함께 확인할 것

- 인증: login, registration, invite, reverify, reset, admin scope
- 게시판: draft, create, edit, revision, comment, recommendation, bookmark, search
- 파일: upload, attach, permissioned download, delete, backup pair
- 메시지: room switch, reconnect, history prepend, read state, autoscroll
- 알림: grouping key, unread count, group read, independent system notices
- IGK: idempotency, balance, ledger, concurrent transfer, ranking
- 운영: migration, health, audit log, backup, rollback
