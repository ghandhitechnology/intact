# Intact · 인텍트

인텍트는 인천과학고 재학생을 위한 비공개 생활 포털입니다. 질문과 자료를 공유하고, 대회 팀을 모집하고, 실시간 메시지와 알림으로 학교 안의 활동을 연결합니다.

- 운영 주소: [https://ishsoutside.com](https://ishsoutside.com)
- 소스 저장소: [ghandhitechnology/intact](https://github.com/ghandhitechnology/intact)
- 운영·배포 인수인계: [DEPLOYMENT_HANDOVER.md](./DEPLOYMENT_HANDOVER.md)
- 시스템 구조와 데이터 흐름: [ARCHITECTURE.md](./ARCHITECTURE.md)

실제 비밀번호, 암호화 키, 운영 DB, 첨부 파일 및 백업은 저장소에 포함하지 않습니다.

## 현재 제공 기능

- 질문·대회 모집·자료·자유·공지 게시판
- 게시글 임시저장, 수정 이력, 댓글·답글, 추천, 북마크, 통합 검색
- private MinIO 기반 첨부 파일 업로드와 권한이 적용된 다운로드
- 1:1·그룹 메시지, Socket.IO 실시간 수신, 읽음 상태, 이전 대화 불러오기
- 게시글·메시지 단위로 묶이는 알림과 Web Push 기반 PWA
- 활동 보상 IGK, 송금, 원장, 누적 기여 랭킹과 레벨
- 학생 초대·가입·재인증·비밀번호 재설정
- 관리자 대시보드, 공지, 신고, 제재, 사용자·초대 관리와 감사 로그

학생 계정은 다음 범위의 6자리 학번만 허용합니다.

```text
^(31|32|33)(11|12|13|14)(0[1-9]|1[0-9]|20)$
```

`User.loginId`와 `StudentIdentity.studentCode`에는 DB 고유 인덱스가 있어 같은 학번으로 계정을 두 개 만들 수 없습니다. 가입 API도 같은 조건을 transaction 안에서 다시 검사합니다.

## 기술 구성

| 영역 | 구성 |
| --- | --- |
| Web/UI/API | Next.js 15 App Router, React 18, TypeScript, Tailwind CSS |
| 데이터 | PostgreSQL 16, Prisma 5 |
| 실시간 | Socket.IO, Redis |
| 파일 | MinIO/S3 호환 private bucket |
| 프록시/TLS | Caddy 2 |
| 실행 | Docker Compose, Node.js 20, Yarn 1.22.22 |

```text
.
├── client/                  Web UI, REST API, Prisma schema/migrations, PWA
├── server/chat/             Socket.IO realtime gateway
├── deploy/                  Production backup script and systemd units
├── design/                  Archived prototypes; not loaded in production
├── Caddyfile                HTTPS and /socket.io reverse proxy
├── docker-compose.yml       Complete production stack
├── ARCHITECTURE.md          Runtime boundaries and data flows
└── DEPLOYMENT_HANDOVER.md   VPS operations, backup, restore and rollback
```

`igwak`, `igwak-portal`, `IGK` 같은 기존 내부 식별자는 운영 DB·Docker 볼륨·보상 단위와의 호환성을 위해 유지합니다. 사용자에게 보이는 서비스명은 `인텍트`입니다.

## 빠른 로컬 실행

### 필요한 도구

- Node.js 20
- Corepack/Yarn 1.22.22
- Docker Engine과 Docker Compose v2

### 전체 스택

```bash
git clone https://github.com/ghandhitechnology/intact.git
cd intact
cp .env.example .env
```

`.env`의 모든 `replace-*` 값을 서로 다른 난수로 바꿉니다. 로컬 개발용 값이라도 운영 비밀값을 복사하지 마세요.

```bash
openssl rand -hex 32
docker compose config --quiet
docker compose up -d --build postgres redis minio minio-init migrate web realtime
docker compose ps
```

- Web: `http://localhost:3000`
- Realtime: `http://localhost:3001`
- MinIO console: `http://localhost:9001`

`caddy`는 실제 도메인의 TLS를 담당하므로 일반 로컬 개발에서는 시작하지 않아도 됩니다.

### 소스 직접 실행

의존 서비스와 환경변수를 준비한 상태에서:

```bash
cd client
corepack enable
corepack yarn install --frozen-lockfile
corepack yarn prisma generate
corepack yarn prisma migrate deploy
corepack yarn dev
```

다른 터미널에서:

```bash
cd server/chat
corepack enable
corepack yarn install --frozen-lockfile
corepack yarn dev
```

UI만 빠르게 확인하는 데모 모드가 있지만 API·DB·실시간 기능의 검증을 대신하지 않습니다. production에서는 `PORTAL_DEMO_MODE`와 `NEXT_PUBLIC_PORTAL_DEMO_MODE`를 반드시 `false`로 둡니다.

## 검증

```bash
cd client
corepack yarn lint
DATABASE_URL='postgresql://user:password@localhost:5432/db?schema=public' corepack yarn prisma validate
corepack yarn tsc --noEmit
corepack yarn build

cd ../server/chat
corepack yarn build
```

Docker 배포 전에는 추가로 다음을 확인합니다.

```bash
git diff --check
docker compose config --quiet
```

운영 배포는 반드시 백업 후 진행하고, `/api/health`, Socket.IO handshake, 로그인, 글·첨부·메시지·알림 경로를 실제 환경에서 확인합니다. 전체 절차는 [DEPLOYMENT_HANDOVER.md](./DEPLOYMENT_HANDOVER.md)를 따릅니다.

## 보안 원칙

- `.env`, 개인키, DB dump, SQLite 파일, 첨부 파일과 backup archive는 Git에 올리지 않습니다.
- 운영에서 `prisma db push`를 사용하지 않고 migration을 검토한 뒤 `prisma migrate deploy`를 실행합니다.
- MinIO bucket과 Web/realtime 내부 포트는 공개하지 않습니다.
- `PORTAL_ENCRYPTION_KEY`는 기존 실명 데이터를 복호화하는 데 필요하므로 별도 비밀 저장소에 백업합니다.
- 관리자와 포털 세션은 분리하며, 관리자 작업은 감사 로그에 남깁니다.

## 문서 갱신 규칙

API 경계나 서비스 구성이 바뀌면 `ARCHITECTURE.md`를, 도메인·서버·볼륨·배포·백업 절차가 바뀌면 `DEPLOYMENT_HANDOVER.md`를 같은 변경 세트에서 갱신합니다.
