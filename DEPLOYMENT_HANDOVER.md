# 인텍트 운영·배포 인수인계서

마지막 현장 확인: 2026-07-15 (Asia/Seoul)

이 문서는 새 개발자나 자동화 에이전트가 별도 대화 기록 없이 인텍트를 로컬에서 실행하고, 운영 VPS에 안전하게 배포하고, 장애 복구까지 수행할 수 있도록 현재 구성을 정리한 기준 문서입니다. 비밀번호, 세션 키, 암호화 키 같은 실제 비밀값은 절대 이 문서나 Git에 기록하지 않습니다.

프로젝트 기능과 빠른 시작은 [README.md](./README.md), 런타임 경계와 데이터 흐름은 [ARCHITECTURE.md](./ARCHITECTURE.md)를 먼저 확인합니다. 안정성 회귀와 부하 기준은 [STABILITY_REPORT.md](./STABILITY_REPORT.md)에 기록합니다.

## 1. 현재 운영 환경

| 항목 | 현재 값 |
| --- | --- |
| 서비스명 | 인텍트 |
| GitHub | `https://github.com/ghandhitechnology/intact` |
| 공개 주소 | `https://ishsoutside.com` |
| `www` 주소 | `https://www.ishsoutside.com` → 본 도메인으로 영구 리디렉션 |
| VPS | Hostinger, `187.127.206.150` |
| SSH 사용자 | `root` |
| 로컬 배포 키 | `~/.ssh/ishsoutside_deploy` |
| 배포 키 지문 | `SHA256:x1FOplEp8aZ/LDb+MrAswPGQMZWug3CKF0DkSgSgp3E` (ED25519) |
| 서버 앱 경로 | `/opt/ishsoutside` |
| 운영체제 | Ubuntu 24.04 LTS, x86_64 |
| Docker | 29.x |
| Docker Compose | 2.40.x |
| 방화벽 공개 포트 | SSH, TCP 80/443, UDP 443 |
| 웹 내부 바인딩 | `127.0.0.1:3000` |
| 실시간 내부 바인딩 | `127.0.0.1:3001` |
| MinIO 콘솔 | `127.0.0.1:9001` |

SSH 확인:

```bash
ssh -i ~/.ssh/ishsoutside_deploy \
  -o StrictHostKeyChecking=accept-new \
  root@187.127.206.150
```

키가 없거나 지문이 다르면 임의로 다른 개인키를 사용하지 말고 Hostinger hPanel에서 배포용 공개키를 다시 등록합니다. 개인키는 채팅, Git, VPS 앱 폴더에 복사하지 않습니다.

## 2. 저장소와 서비스 구조

저장소를 받을 때:

```bash
git clone https://github.com/ghandhitechnology/intact.git
cd intact
export REPO_ROOT="$PWD"
```

저장소 구조:

```text
intact/
├── client/                  Next.js 15 App Router, API, Prisma, PWA
├── client/prisma/           PostgreSQL 스키마와 순차 migration
├── server/chat/             Socket.IO 실시간 게이트웨이
├── deploy/                  백업 스크립트와 systemd unit
├── Caddyfile                HTTPS와 /socket.io 프록시
├── docker-compose.yml       운영 서비스 정의
├── .env.example             운영 환경변수 템플릿
└── DEPLOYMENT_HANDOVER.md   이 문서
```

운영 Compose 프로젝트명은 `igwak-portal`입니다. 이름은 기존 Docker 볼륨과 연결되므로 서비스 리브랜딩만을 이유로 변경하지 않습니다.

| Compose 서비스 | 역할 | 영속 데이터 |
| --- | --- | --- |
| `caddy` | TLS 인증서, HTTPS, gzip/zstd, WebSocket 프록시 | `caddy_data`, `caddy_config` |
| `web` | Next.js UI와 REST API | 없음 |
| `migrate` | `prisma migrate deploy` 일회 실행 | PostgreSQL 사용 |
| `realtime` | Socket.IO 메시지·읽음·접속 상태 | Redis와 Web API 사용 |
| `postgres` | 회원, 게시글, 메시지, IGK, 운영 데이터 | `postgres_data` |
| `redis` | 실시간 fan-out, 세션성/속도 제한 데이터 | `redis_data` |
| `minio` | 비공개 첨부 파일 저장 | `object_data` |
| `minio-init` | bucket 생성 및 public access 차단 | 일회 실행 |

현재 운영 볼륨의 정확한 이름:

```text
igwak-portal_caddy_config
igwak-portal_caddy_data
igwak-portal_object_data
igwak-portal_postgres_data
igwak-portal_redis_data
```

Caddy는 `/socket.io/*`만 `realtime:3001`로 보내고 나머지는 `web:3000`으로 보냅니다. Web, realtime, MinIO 콘솔 포트는 localhost에만 바인딩되며 인터넷에 직접 노출하면 안 됩니다.

## 3. 필요한 도구

로컬 개발:

- Node.js 20
- Corepack 및 Yarn 1.22.22
- Docker Engine/Compose 또는 별도 PostgreSQL 16, Redis, MinIO
- Prisma CLI는 `client`의 dev dependency 사용

기본 설치:

```bash
cd "$REPO_ROOT/client"
corepack enable
corepack yarn install --frozen-lockfile

cd ../server/chat
corepack yarn install --frozen-lockfile
```

## 4. 환경변수와 비밀값

운영 서버의 실제 값은 `/opt/ishsoutside/.env`에만 둡니다. 권한은 `600`, 소유자는 `root:root`를 권장합니다.

```bash
install -m 600 .env.example .env
openssl rand -hex 32
```

서로 다른 난수로 반드시 분리할 값:

- `POSTGRES_PASSWORD`
- `SESSION_SECRET`
- `PORTAL_ENCRYPTION_KEY`
- `INTERNAL_API_SECRET`
- `S3_SECRET_KEY`
- 필요 시 `VAPID_PRIVATE_KEY`

중요 환경변수:

| 키 | 의미/운영 값 |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://ishsoutside.com` |
| `NEXT_PUBLIC_REALTIME_URL` | `https://ishsoutside.com` |
| `NEXT_PUBLIC_PORTAL_DEMO_MODE` | production에서는 반드시 `false` |
| `PORTAL_DEMO_MODE` | production에서는 반드시 `false` |
| `DATABASE_URL` | 컨테이너 밖 도구용 URL. 비밀번호와 실제 호스트 확인 |
| `POSTGRES_*` | Compose 내부 PostgreSQL 생성 정보 |
| `SESSION_SECRET` | 포털 세션 서명/파생에 사용. 변경 시 모든 로그인 무효화 가능 |
| `PORTAL_ENCRYPTION_KEY` | 실명 등 암호화 데이터용. 백업 없이 교체하면 기존 데이터 복호화 불가 |
| `INTERNAL_API_SECRET` | web ↔ realtime 내부 인증 |
| `S3_*` | MinIO endpoint, private bucket, 접근 키 |
| `ADMIN_INITIAL_*` | 최초 관리자 생성용. 최초 로그인 뒤 관리자 비밀번호 변경 |
| `RIRO_AUTH_ENABLED` | 공식 연동 승인 전 `false` 유지 |
| `TRUST_PROXY` | 프록시 헤더가 신뢰 가능한 경우에만 `true` |

`NEXT_PUBLIC_*` 값은 Docker 이미지 빌드 시 번들에 포함됩니다. 이 값을 바꾼 뒤에는 컨테이너 재시작만 하지 말고 반드시 `web`과 필요 시 `realtime` 이미지를 다시 빌드합니다.

비밀값을 확인해야 할 때도 값을 터미널 출력이나 작업 보고서에 복사하지 않습니다. 키 이름만 확인:

```bash
sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' /opt/ishsoutside/.env | sort
```

## 5. 로컬 개발

### Docker로 전체 스택 실행

저장소 루트에 개발용 `.env`를 준비한 뒤 Caddy를 제외한 전체 스택을 실행합니다. Compose의 PostgreSQL과 MinIO API는 호스트에 공개되지 않으므로, 별도 포트 설정 없이 Web만 호스트에서 직접 실행하려고 하면 연결할 수 없습니다.

```bash
cd "$REPO_ROOT"
cp .env.example .env
# .env의 replace-* 값을 서로 다른 개발용 난수로 교체
docker compose config --quiet
docker compose up -d --build postgres redis minio minio-init migrate web realtime
docker compose ps
```

Web은 `http://localhost:3000`, realtime은 `http://localhost:3001`, MinIO console은 `http://localhost:9001`에서 확인합니다. production `.env`를 로컬로 복사하지 않습니다.

### 소스를 호스트에서 직접 실행

Web과 realtime을 Docker 밖에서 실행하려면 PostgreSQL, Redis, MinIO API를 호스트에서 접근할 수 있게 별도로 준비하고 `client/.env.local`을 그 주소에 맞춰야 합니다.

Web:

```bash
cd "$REPO_ROOT/client"
corepack yarn install --frozen-lockfile
corepack yarn prisma migrate deploy
corepack yarn prisma generate
corepack yarn dev
```

Realtime:

```bash
cd "$REPO_ROOT/server/chat"
corepack yarn install --frozen-lockfile
corepack yarn dev
```

### 데모 모드

UI만 확인할 때 사용할 수 있지만 실제 API, 중복 계정, DB 동시성 검증을 대체하지 않습니다.

```bash
NEXT_PUBLIC_PORTAL_DEMO_MODE=true PORTAL_DEMO_MODE=true corepack yarn dev
```

production에서는 두 demo mode 값을 모두 `false`로 둡니다.

## 6. 학번과 계정 불변 조건

2026-07-14부터 일반 학생 학번은 다음 정규식만 허용합니다.

```text
^(31|32|33)(11|12|13|14)(0[1-9]|1[0-9]|20)$
```

- 앞 2자리: `31`, `32`, `33`
- 가운데 2자리: `11`, `12`, `13`, `14`
- 마지막 2자리: `01`~`20`
- 예: `331101`, `321420`
- 불가: `301101`, `331501`, `331121`, 문자/공백 포함 값

검증 기준 파일은 `client/src/lib/student-code.ts`입니다. 로그인, 공개 가입, 관리자 초대, 초대 확인, 재인증, 비밀번호 재설정, 리로 인증이 동일 규칙을 사용해야 합니다.

중복은 애플리케이션의 사전 확인과 PostgreSQL 제약으로 이중 차단합니다.

- `User.loginId`: `@unique`
- `StudentIdentity.studentCode`: `@unique`
- `StudentIdentity.userId`: `@unique`
- `User`, `StudentIdentity`, `StudentInvite`, `VerificationTicket`: 동일 정규식의 DB `CHECK` 제약
- 가입 transaction: `Serializable`
- Prisma `P2002`: HTTP 409 conflict로 변환

운영 중 중복/범위 점검:

```sql
SELECT "studentCode", count(*)
FROM "StudentIdentity"
GROUP BY "studentCode"
HAVING count(*) > 1;

SELECT "studentCode"
FROM "StudentIdentity"
WHERE substring("studentCode", 1, 2) NOT IN ('31', '32', '33')
   OR substring("studentCode", 3, 2) NOT IN ('11', '12', '13', '14')
   OR substring("studentCode", 5, 2)::int NOT BETWEEN 1 AND 20;
```

2026-07-14 운영 DB 점검 결과: 학생 계정 2개, 새 범위 밖 계정 0개, 중복 학번 0개, 중복 로그인 ID 0개.

## 7. 새 VPS 최초 구축

1. Ubuntu 24.04에 Docker Engine과 Compose plugin을 설치합니다.
2. 배포 전용 ED25519 공개키를 `root` 또는 별도 deploy 사용자에게 등록합니다.
3. UFW에서 SSH, TCP 80/443, UDP 443만 엽니다.
4. DNS `A` 레코드로 `ishsoutside.com`과 `www.ishsoutside.com`을 VPS IP에 연결합니다.
5. 코드를 `/opt/ishsoutside`에 배치합니다.
6. `.env.example`을 `.env`로 복사하고 모든 비밀값과 공개 URL을 교체합니다.
7. `.env` 권한을 제한합니다.
8. 전체 stack을 빌드·시작합니다.

```bash
cd /opt/ishsoutside
chmod 600 .env
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

`migrate`가 성공해야 `web`이 시작되고, `minio-init`이 성공해야 private bucket이 준비됩니다. Caddy는 Web health와 realtime 시작 이후 공개 트래픽을 받습니다.

관리자 최초 로그인:

1. `/admin/login`에서 `ADMIN_INITIAL_ID`, `ADMIN_INITIAL_PASSWORD` 사용
2. 즉시 `/admin/change-password`에서 12자 이상 새 비밀번호로 변경
3. 일반 포털 `/login`과 관리자 로그인은 별도 세션·cookie를 사용

## 8. 표준 배포 절차

### 8.1 배포 전 로컬 검사

```bash
cd "$REPO_ROOT/client"
corepack yarn lint
corepack yarn prisma validate
corepack yarn tsc --noEmit
corepack yarn build

cd ../server/chat
corepack yarn build
```

`git status --short`와 `git diff --check`도 확인합니다. 현재 작업 트리에 다른 사용자의 변경이 있으면 덮어쓰거나 reset하지 않습니다.

### 8.2 배포 전 운영 백업

```bash
ssh -i ~/.ssh/ishsoutside_deploy root@187.127.206.150 \
  'systemctl start ishsoutside-backup.service && systemctl status ishsoutside-backup.service --no-pager'
```

### 8.3 서버로 소스 동기화

반드시 저장소 루트에서 실행합니다. `.env`, DB, 업로드 볼륨, build 산출물은 전송하지 않습니다.

```bash
cd "$REPO_ROOT"
rsync -az --delete \
  -e 'ssh -i ~/.ssh/ishsoutside_deploy -o StrictHostKeyChecking=accept-new' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.production.backup' \
  --exclude='.DS_Store' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='__pycache__' \
  --exclude='*.tsbuildinfo' \
  ./ root@187.127.206.150:/opt/ishsoutside/
```

여러 파일을 목적 디렉터리 하나에 직접 rsync하면 경로가 평탄화될 수 있습니다. 부분 배포보다 위 전체 동기화 명령을 사용합니다. `--delete`를 쓰므로 실행 위치가 저장소 루트인지 먼저 `pwd`로 확인합니다.

### 8.4 코드만 바뀐 경우

```bash
ssh -i ~/.ssh/ishsoutside_deploy root@187.127.206.150 \
  'cd /opt/ishsoutside && docker compose build web && docker compose up -d --no-deps web'
```

Realtime 코드도 바뀐 경우:

```bash
ssh -i ~/.ssh/ishsoutside_deploy root@187.127.206.150 \
  'cd /opt/ishsoutside && docker compose build web realtime && docker compose up -d --no-deps web realtime'
```

### 8.5 Prisma migration이 추가된 경우

DB 백업이 성공한 뒤 migration을 먼저 별도 실행합니다.

```bash
ssh -i ~/.ssh/ishsoutside_deploy root@187.127.206.150 <<'REMOTE'
set -eu
cd /opt/ishsoutside
docker compose build migrate web realtime
docker compose run --rm migrate
docker compose up -d --no-deps web realtime
docker compose up -d caddy
REMOTE
```

파괴적 migration, column rename/drop, 대량 backfill은 위 명령을 바로 쓰지 말고 별도 maintenance 계획과 복구 시험을 먼저 만듭니다. `prisma db push`는 production에서 사용하지 않습니다.

## 9. 배포 후 검증

### 컨테이너와 로그

```bash
ssh -i ~/.ssh/ishsoutside_deploy root@187.127.206.150 <<'REMOTE'
cd /opt/ishsoutside
docker compose ps
docker compose logs --tail=100 web
docker compose logs --tail=100 realtime
docker inspect --format='{{.State.Health.Status}}' igwak-portal-web-1
REMOTE
```

`web`, `realtime`, `postgres`, `redis`는 `healthy`여야 합니다. `migrate`와 `minio-init`은 성공 후 종료되는 일회성 서비스입니다. realtime health 응답의 `connections`는 현재 연결 수이며 0도 정상입니다.

### 공개 endpoint

```bash
curl -fsS https://ishsoutside.com/api/health
curl -fsS https://ishsoutside.com/manifest.webmanifest
curl -fsS 'https://ishsoutside.com/socket.io/?EIO=4&transport=polling'
```

기능 smoke test가 끝난 뒤 공개 읽기 부하를 실행합니다. 운영 중에는 기본값보다 높은 동시성을 임의로 사용하지 않습니다.

```bash
docker run --rm \
  -v "$PWD/scripts:/work:ro" \
  -w /work \
  node:20-alpine \
  node stress-readonly.mjs \
    --base=https://ishsoutside.com \
    --requests=120 \
    --concurrency=12
```

network error 또는 5xx가 있으면 스크립트가 실패합니다. p95가 기존 [안정성 기준](./STABILITY_REPORT.md)보다 크게 악화되면 컨테이너 log와 PostgreSQL 상태를 확인한 뒤 배포를 완료하지 않습니다.

기대 결과:

- `/api/health`: HTTP 200, `status=ok`, `database=connected`
- manifest: `name`과 `short_name`이 `인텍트`
- Socket.IO: HTTP 200과 `sid`, `upgrades:["websocket"]`
- 비로그인 `/`: `/login?returnTo=%2F`로 307 리디렉션
- `/login` 브라우저 제목: `인텍트 · 인천과학고 생활 포털`

### 인증 회귀 검사

동일 origin 검사를 통과하도록 `Origin`을 지정합니다. 실제 계정 비밀번호를 테스트 로그에 남기지 않습니다.

```bash
curl -sS -i https://ishsoutside.com/api/auth/login \
  -H 'Origin: https://ishsoutside.com' \
  -H 'Content-Type: application/json' \
  --data '{"studentId":"341101","password":"not-a-real-password"}'
```

허용되지 않은 학번은 HTTP 400/`INVALID_STUDENT_CODE`여야 합니다. 허용 형식이지만 존재하지 않는 학번은 HTTP 401이어야 하며, 테스트 반복으로 rate limit을 소모하지 않도록 최소 횟수만 실행합니다.

로그인된 staging/test 계정으로 추가 확인:

- 글 작성·임시저장·수정·삭제
- 20MB 이하 파일 업로드, 게시글 연결, 다운로드, 삭제
- 다른 로그인 사용자로 이미지 inline 미리보기와 `?download=1` 원본 다운로드
- 사진게시판에 여러 이미지 게시, 묶음 펼치기와 전체화면 미리보기
- 메시지 방 전환, 100개 최근 내역, 이전 내역 로딩, 자동 스크롤, 읽음 상태
- 알림 그룹 접기/펼치기와 그룹 읽음
- 관리자 초대 발급 시 학번 범위와 중복 차단
- 관리자 IGK 지급·회수 후 잔액, 원장, 사용자 알림과 감사 로그 일치
- IGK 선물 후 수신자의 `currentIgk`, `lifetimeIgk`, 등급이 함께 갱신되고 랭킹이 현재 잔액 순으로 바뀌는지 확인
- `/igk/roadmap`에 9등급부터 선생님까지 10단계가 표시되는지 확인
- 테스트 데이터 정리

## 10. 백업

운영 backup unit:

- 스크립트 소스: `deploy/backup-production.sh`
- 설치 경로: `/usr/local/sbin/backup-ishsoutside`
- service: `ishsoutside-backup.service`
- timer: `ishsoutside-backup.timer`
- 실행 시각: 매일 03:30 Asia/Seoul, 최대 10분 무작위 지연
- 저장 경로: `/var/backups/ishsoutside`
- 기본 보존: 14일
- 권한: 디렉터리 `700`, 파일 `600`

백업 대상:

- PostgreSQL custom-format dump를 gzip으로 압축
- MinIO `object_data` 전체 tar.gz

Redis와 Caddy 볼륨은 현재 백업 스크립트 대상이 아닙니다. Redis의 메시지 원본은 PostgreSQL에 있고 세션성 데이터는 재생성 가능하지만, 요구사항이 바뀌면 별도 백업 정책을 추가합니다. Caddy 인증서는 재발급 가능합니다.

timer 설치/갱신:

```bash
install -m 755 deploy/backup-production.sh /usr/local/sbin/backup-ishsoutside
install -m 644 deploy/ishsoutside-backup.service /etc/systemd/system/
install -m 644 deploy/ishsoutside-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ishsoutside-backup.timer
systemctl list-timers ishsoutside-backup.timer --no-pager
```

백업은 같은 VPS 디스크에만 있으므로 VPS 전체 장애를 막지 못합니다. 정기적으로 암호화된 off-site 저장소에 복사하고, 월 1회 별도 임시 DB/볼륨에서 실제 복구 시험을 수행합니다. `.env`와 `PORTAL_ENCRYPTION_KEY`는 별도 비밀 관리 저장소에 보관해야 암호화된 실명을 복구할 수 있습니다.

## 11. 복구

복구는 기존 데이터를 덮어쓰므로 정확한 백업 파일과 변경 승인 후 수행합니다. 먼저 현재 상태를 다시 백업하고 Web/realtime 쓰기를 멈춥니다.

### PostgreSQL

```bash
cd /opt/ishsoutside
docker compose stop web realtime
gunzip -c /var/backups/ishsoutside/postgres-YYYYMMDDTHHMMSSZ.dump.gz > /tmp/restore.dump
docker compose exec -T postgres pg_restore \
  --clean --if-exists --no-owner \
  --username igwak --dbname igwak < /tmp/restore.dump
rm -f /tmp/restore.dump
docker compose up -d web realtime
```

환경에서 기본 DB 사용자/이름을 변경했다면 `igwak`을 `.env` 값으로 교체합니다.

### MinIO 업로드

```bash
cd /opt/ishsoutside
docker compose stop web realtime minio
docker run --rm \
  -v igwak-portal_object_data:/data \
  -v /var/backups/ishsoutside:/backup:ro \
  alpine:3.20 sh -c 'rm -rf /data/* && tar -C /data -xzf /backup/uploads-YYYYMMDDTHHMMSSZ.tar.gz'
docker compose up -d minio minio-init web realtime
```

DB와 업로드는 같은 시각의 backup pair를 사용해야 attachment record와 실제 object가 일치합니다.

## 12. 롤백

코드 배포 전 현재 이미지를 별도 tag로 보관하면 빠른 롤백이 가능합니다.

```bash
cd /opt/ishsoutside
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker image tag igwak-portal-web:latest "igwak-portal-web:rollback-$STAMP"
docker image tag igwak-portal-realtime:latest "igwak-portal-realtime:rollback-$STAMP"
```

롤백 시 선택한 tag를 다시 `latest`로 지정하고 서비스를 재생성합니다.

```bash
docker image tag igwak-portal-web:rollback-TIMESTAMP igwak-portal-web:latest
docker compose up -d --no-deps --force-recreate web
```

Migration이 이미 실행됐다면 이미지 롤백만으로 충분하지 않을 수 있습니다. backward-compatible migration이 아니면 DB 복구 계획을 함께 실행합니다.

## 13. 장애 대응 빠른 순서

1. 공개 health와 HTTP status 확인
2. `docker compose ps`로 health/restart 확인
3. `docker compose logs --since=30m web realtime caddy` 확인
4. PostgreSQL/Redis health 확인
5. 디스크 사용량과 inode 확인
6. 최근 배포와 migration 확인
7. 원인이 코드면 직전 이미지 롤백, 데이터면 승인 후 backup 복구

명령:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://ishsoutside.com/login
curl -fsS https://ishsoutside.com/api/health

cd /opt/ishsoutside
docker compose ps
docker compose logs --since=30m --tail=300 web realtime caddy
df -h /
docker system df
```

흔한 원인:

- `web` unhealthy: DB 연결, migration 실패, 잘못된 env, Next 런타임 예외
- 브라우저는 열리나 채팅 불가: `NEXT_PUBLIC_REALTIME_URL`, `/socket.io/*` 프록시, realtime 내부 secret 확인
- 첨부 실패: MinIO health, private bucket, S3 key, 20MB 제한 확인
- Prisma UUID 오류: board slug를 UUID field에 직접 조회하지 않았는지 확인
- advisory lock 오류: 결과 row가 필요 없는 PostgreSQL lock은 Prisma `$executeRaw` 사용
- 새 공개 env가 반영되지 않음: `NEXT_PUBLIC_*` 변경 후 Web 이미지 재빌드

## 14. 보안과 운영 원칙

- `.env`, DB dump, 업로드 backup, private key를 Git에 추가하지 않습니다.
- production에서 `prisma db push`, demo mode, public MinIO bucket을 사용하지 않습니다.
- 실제 사용자 계정으로 자동화 테스트 메시지를 보내지 않습니다. 전용 test/staging 계정을 사용합니다.
- 관리자 조치와 초대 발급은 감사 로그를 유지합니다.
- 로그인/가입 endpoint rate limit을 우회하거나 대량 호출하지 않습니다.
- 비밀 회전 시 영향 범위를 먼저 확인합니다. 특히 `PORTAL_ENCRYPTION_KEY`는 기존 암호문 복호화에 필요합니다.
- Docker 볼륨 이름과 Compose 프로젝트명은 migration 계획 없이 변경하지 않습니다.
- 운영 변경 후 로컬 build 성공만으로 종료하지 않고 공개 endpoint와 실제 사용자 경로를 확인합니다.

## 15. 인수인계 체크리스트

- [ ] 저장소와 운영 서버 경로 확인
- [ ] SSH deploy key 및 지문 확인
- [ ] `.env` 키 목록과 비밀 저장 위치 확인
- [ ] `docker compose config --quiet` 통과
- [ ] 모든 container/volume 역할 이해
- [ ] 로컬 lint, typecheck, build 통과
- [ ] DB/MinIO 수동 backup 성공
- [ ] migration 유무 확인
- [ ] rsync 제외 목록 확인
- [ ] 배포 후 Web/Postgres/Redis health 확인
- [ ] 공개 health, manifest, Socket.IO handshake 확인
- [ ] 로그인·가입·중복 학번 차단 확인
- [ ] 글·첨부·채팅·알림 smoke test
- [ ] backup timer와 off-site backup 확인
- [ ] 롤백 이미지/tag와 DB 복구 지점 기록

운영 구성이 바뀌면 배포 작업과 같은 변경 세트에서 이 문서도 함께 갱신합니다.
