# 인텍트 빠른 배포·오류 해결 런북

마지막 갱신: 2026-07-16 (Asia/Seoul)

이 문서는 운영 VPS에 인텍트를 가장 짧은 절차로 안전하게 배포하고, 배포 중 나타날 수 있는 현재 스택의 오류를 증상부터 찾아 복구하기 위한 현장용 런북입니다. 처음 서버를 구축하거나 DB·업로드를 복구해야 한다면 [운영·배포 인수인계서](./DEPLOYMENT_HANDOVER.md)를 먼저 사용합니다.

실제 비밀번호, `.env`, 개인키, DB dump, 업로드 backup은 이 문서와 Git에 기록하지 않습니다.

## 1. 운영 고정값

| 항목 | 값 |
| --- | --- |
| 공개 주소 | `https://ishsoutside.com` |
| SSH | `root@187.127.206.150` |
| 로컬 개인키 | `~/.ssh/ishsoutside_deploy` |
| 서버 소스 | `/opt/ishsoutside` |
| Compose 프로젝트 | `igwak-portal` |
| 수동 backup unit | `ishsoutside-backup.service` |
| backup 위치 | `/var/backups/ishsoutside` |

이 런북의 모든 로컬 명령은 저장소 루트에서 시작합니다.

```bash
cd /path/to/intact
export REPO_ROOT="$PWD"
test -f docker-compose.yml && test -d client && test -d server/chat
git remote get-url origin | grep -Eq '(^|[:/])ghandhitechnology/intact(\.git)?$'
```

검사가 하나라도 실패하면 중단합니다. 특히 `rsync --delete`를 다른 폴더에서 실행하면 운영 소스를 지울 수 있습니다.

## 2. 30초 배포 경로 선택

배포할 diff에 포함된 가장 큰 변경을 기준으로 한 경로만 선택합니다.

| 변경 범위 | 실행 경로 | 예상 영향 |
| --- | --- | --- |
| `client/**` UI·API만 변경, migration 없음 | A. Web만 | 가장 빠름, Web만 재생성 |
| `server/chat/**` 또는 Web+채팅 변경 | B. Web+realtime | 채팅 연결이 잠깐 재연결됨 |
| `client/prisma/migrations/**` 추가 | C. Migration 포함 | backup 필수, DB 호환성 확인 |
| `docker-compose.yml`, `Caddyfile`, 운영 env 변경 | D. 인프라/env | 구성 검증 후 영향 서비스 재생성 |

서버에 배포 commit 표식이 있으면 변경 범위를 빠르게 확인할 수 있습니다.

```bash
LAST_DEPLOYED=$(ssh -i ~/.ssh/ishsoutside_deploy root@187.127.206.150 \
  'cat /opt/ishsoutside/.deployed-commit 2>/dev/null || true')

if [ -n "$LAST_DEPLOYED" ] && git cat-file -e "$LAST_DEPLOYED^{commit}" 2>/dev/null; then
  git diff --name-status "$LAST_DEPLOYED"..HEAD
else
  echo "배포 commit 표식 없음: 이번에는 변경 파일을 직접 확인하고 C 경로를 선택하면 가장 안전함"
fi
```

첫 실행이나 squash/rebase 때문에 표식을 찾을 수 없으면 migration 유무를 직접 확인합니다. 확실하지 않으면 C 경로를 사용합니다. `prisma migrate deploy`는 적용할 migration이 없으면 아무 데이터도 변경하지 않고 끝납니다.

### 가장 자주 쓰는 Web-only 단축 절차

CI 또는 로컬 production build를 이미 통과했고, 변경이 `client/**`뿐이며 Prisma migration과 env 변경이 없을 때 사용합니다. 이 한 블록이 backup, rollback tag, sync, Web 재배포, health 검사와 commit 기록을 수행합니다.

```bash
set -eu
export REPO_ROOT="$PWD"
export SSH_KEY="$HOME/.ssh/ishsoutside_deploy"
export TARGET="root@187.127.206.150"

test -f "$REPO_ROOT/docker-compose.yml"
test -d "$REPO_ROOT/client"
git -C "$REPO_ROOT" remote get-url origin | \
  grep -Eq '(^|[:/])ghandhitechnology/intact(\.git)?$'
test -z "$(git -C "$REPO_ROOT" status --porcelain)" || {
  echo "작업 트리가 깨끗하지 않음: commit한 뒤 다시 실행"
  exit 1
}
git -C "$REPO_ROOT" diff --check
DEPLOY_COMMIT=$(git -C "$REPO_ROOT" rev-parse HEAD)

ssh -i "$SSH_KEY" "$TARGET" <<'REMOTE'
set -eu
systemctl start ishsoutside-backup.service
test "$(systemctl show ishsoutside-backup.service -p Result --value)" = success
test "$(systemctl show ishsoutside-backup.service -p ExecMainStatus --value)" = 0
cd /opt/ishsoutside
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker image tag igwak-portal-web:latest "igwak-portal-web:rollback-$STAMP"
echo "rollback tag: $STAMP"
REMOTE

rsync -az --delete \
  -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new" \
  --exclude='.git' --exclude='.env' --exclude='.env.production.backup' \
  --exclude='.deployed-commit' --exclude='.DS_Store' \
  --exclude='node_modules' --exclude='.next' --exclude='__pycache__' \
  --exclude='*.tsbuildinfo' \
  "$REPO_ROOT/" "$TARGET:/opt/ishsoutside/"

ssh -i "$SSH_KEY" "$TARGET" \
  'cd /opt/ishsoutside && docker compose build web && docker compose up -d --no-deps web'

curl -fsS https://ishsoutside.com/api/health
curl -fsS 'https://ishsoutside.com/socket.io/?EIO=4&transport=polling'
ssh -i "$SSH_KEY" "$TARGET" \
  'cd /opt/ishsoutside && docker compose ps && docker compose logs --since=10m --tail=100 web'

printf '%s\n' "$DEPLOY_COMMIT" | ssh -i "$SSH_KEY" "$TARGET" \
  'cat > /opt/ishsoutside/.deployed-commit'
```

명령이 중간에 실패하면 commit 표식은 갱신되지 않습니다. 실패 원인을 7장에서 해결하고, 같은 범위의 배포를 다시 실행합니다.

## 3. 배포 전 최소 검사

### 빠른 검사

이미 같은 commit이 CI 또는 로컬 production build를 통과한 경우에만 사용합니다.

```bash
cd "$REPO_ROOT"
git status --short --branch
git diff --check
docker compose config --quiet
```

예상하지 않은 수정이나 untracked 파일이 보이면 중단합니다. 다른 사람의 변경을 `reset`, `checkout`, `clean`으로 지우지 않습니다.

### 전체 검사

CI 결과가 없거나 dependency, TypeScript, Prisma, Dockerfile이 바뀌었으면 실행합니다.

```bash
cd "$REPO_ROOT/client"
corepack yarn install --frozen-lockfile
corepack yarn prisma generate
corepack yarn lint
corepack yarn prisma validate
corepack yarn tsc --noEmit
corepack yarn build

cd "$REPO_ROOT/server/chat"
corepack yarn install --frozen-lockfile
corepack yarn build
```

## 4. 가장 빠른 안전 배포

아래 공통 준비는 A–D 모든 경로에서 한 번 실행합니다.

### 4.1 Backup과 rollback 이미지 보관

```bash
ssh -i ~/.ssh/ishsoutside_deploy root@187.127.206.150 <<'REMOTE'
set -eu
systemctl start ishsoutside-backup.service
test "$(systemctl show ishsoutside-backup.service -p Result --value)" = success
test "$(systemctl show ishsoutside-backup.service -p ExecMainStatus --value)" = 0
systemctl status ishsoutside-backup.service --no-pager || true

cd /opt/ishsoutside
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker image inspect igwak-portal-web:latest >/dev/null 2>&1 && \
  docker image tag igwak-portal-web:latest "igwak-portal-web:rollback-$STAMP"
docker image inspect igwak-portal-realtime:latest >/dev/null 2>&1 && \
  docker image tag igwak-portal-realtime:latest "igwak-portal-realtime:rollback-$STAMP"
echo "rollback tag: $STAMP"
REMOTE
```

Backup service가 실패하면 소스 동기화를 시작하지 않습니다.

### 4.2 소스 동기화

반드시 `REPO_ROOT`가 올바른지 확인한 뒤 실행합니다. 운영 `.env`, 배포 commit 표식, 데이터 볼륨과 build 산출물은 건드리지 않습니다.

```bash
cd "$REPO_ROOT"
test "$PWD" = "$REPO_ROOT"
test -f docker-compose.yml

rsync -az --delete \
  -e 'ssh -i ~/.ssh/ishsoutside_deploy -o StrictHostKeyChecking=accept-new' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.production.backup' \
  --exclude='.deployed-commit' \
  --exclude='.DS_Store' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='__pycache__' \
  --exclude='*.tsbuildinfo' \
  ./ root@187.127.206.150:/opt/ishsoutside/
```

### 4.3 A — Web만 변경

```bash
ssh -i ~/.ssh/ishsoutside_deploy root@187.127.206.150 \
  'cd /opt/ishsoutside && docker compose build web && docker compose up -d --no-deps web'
```

### 4.4 B — Web+realtime 변경

```bash
ssh -i ~/.ssh/ishsoutside_deploy root@187.127.206.150 \
  'cd /opt/ishsoutside && docker compose build web realtime && docker compose up -d --no-deps web realtime'
```

### 4.5 C — Prisma migration 포함

```bash
ssh -i ~/.ssh/ishsoutside_deploy root@187.127.206.150 <<'REMOTE'
set -eu
cd /opt/ishsoutside
docker compose config --quiet
docker compose build migrate web realtime
docker compose run --rm migrate
docker compose up -d --no-deps web realtime
docker compose up -d caddy
REMOTE
```

Column drop/rename, 대량 backfill, unique constraint 추가처럼 기존 데이터와 충돌할 수 있는 migration은 이 빠른 경로 대상이 아닙니다. maintenance 계획과 restore rehearsal을 먼저 만듭니다.

### 4.6 D — Compose, Caddy, 운영 env 변경

운영 `.env`는 rsync하지 않습니다. SSH로 `/opt/ishsoutside/.env`를 수정하되 값을 화면이나 shell history에 출력하지 않고 권한을 다시 확인합니다.

```bash
ssh -i ~/.ssh/ishsoutside_deploy root@187.127.206.150 <<'REMOTE'
set -eu
cd /opt/ishsoutside
chmod 600 .env
docker compose config --quiet
docker compose run --rm --no-deps --entrypoint caddy caddy \
  validate --config /etc/caddy/Caddyfile
docker compose up -d --build
REMOTE
```

`NEXT_PUBLIC_*` 값은 Web build에 박히므로 env만 바꾸고 restart해서는 반영되지 않습니다. 반드시 `docker compose build web` 후 Web을 재생성합니다. Caddyfile만 바뀌었다면 전체 stack 대신 다음으로 충분합니다.

```bash
ssh -i ~/.ssh/ishsoutside_deploy root@187.127.206.150 \
  'cd /opt/ishsoutside && docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile'
```

## 5. 완료 판정과 commit 기록

### 5.1 자동 smoke test

```bash
curl -fsS https://ishsoutside.com/api/health
curl -fsS https://ishsoutside.com/manifest.webmanifest
curl -fsS 'https://ishsoutside.com/socket.io/?EIO=4&transport=polling'

ssh -i ~/.ssh/ishsoutside_deploy root@187.127.206.150 \
  'cd /opt/ishsoutside && docker compose ps && docker compose logs --since=10m --tail=100 web realtime caddy'

cd "$REPO_ROOT"
node scripts/stress-readonly.mjs \
  --base=https://ishsoutside.com \
  --requests=120 \
  --concurrency=12
```

기대 결과:

- `/api/health`: HTTP 200, `status=ok`, `database=connected`
- manifest: `name`, `short_name`이 `인텍트`
- Socket.IO: HTTP 200, 응답에 `sid`, `upgrades:["websocket"]`
- `web`, `realtime`, `postgres`, `redis`: `healthy`
- `migrate`, `minio-init`: `Exited (0)`이어도 정상
- 부하 검사: network error와 5xx가 0

### 5.2 실제 기능 smoke test

변경한 기능을 직접 한 번 사용합니다. 공통 핵심 경로는 로그인, 게시글 조회, 파일 미리보기/다운로드, 메시지 송수신·읽음, 알림 이동입니다. 실제 사용자에게 테스트 글이나 메시지를 남기지 말고 전용 test 계정을 사용합니다.

### 5.3 성공 commit 기록

모든 검증이 끝난 뒤에만 실행합니다. 다음 배포에서 변경 범위를 바로 계산할 수 있습니다.

```bash
DEPLOY_COMMIT=$(git -C "$REPO_ROOT" rev-parse HEAD)
printf '%s\n' "$DEPLOY_COMMIT" | \
  ssh -i ~/.ssh/ishsoutside_deploy root@187.127.206.150 \
  'cat > /opt/ishsoutside/.deployed-commit'
```

## 6. 상태 해석표

| 상태 | 의미 | 조치 |
| --- | --- | --- |
| `web healthy` | UI/API와 DB health 통과 | 정상 |
| `realtime healthy` | 채팅 gateway 응답 | 정상 |
| `postgres healthy` | DB가 연결을 받음 | 정상 |
| `redis healthy` | `PING` 성공 | 정상 |
| `migrate Exited (0)` | migration 완료 후 정상 종료 | 재시작하지 않음 |
| `minio-init Exited (0)` | private bucket 준비 후 정상 종료 | 재시작하지 않음 |
| `restarting`, `unhealthy` | 시작 실패 또는 health 실패 | 해당 service log 확인 |
| realtime `connections: 0` | 현재 접속자 없음 | 정상 |
| HTTP 307 `/` → `/login` | 비로그인 접근 보호 | 정상 |
| 인증 API HTTP 401 | 세션/자격 증명 없음 | 비로그인 검사라면 정상 |
| HTTP 429 | rate limit 작동 | 배포 실패로 오인하지 말고 호출 중지 |

## 7. 오류별 가장 빠른 해결

먼저 공통 진단을 한 번 수집합니다.

```bash
curl -sS -o /dev/null -w 'login=%{http_code} total=%{time_total}\n' https://ishsoutside.com/login
curl -sS -i https://ishsoutside.com/api/health

ssh -i ~/.ssh/ishsoutside_deploy root@187.127.206.150 <<'REMOTE'
cd /opt/ishsoutside
docker compose ps
docker compose logs --since=30m --tail=300 web realtime caddy postgres redis minio
df -h /
df -i /
docker system df
REMOTE
```

### 7.1 SSH와 rsync

| 증상 | 확인 | 가장 빠른 해결 |
| --- | --- | --- |
| `Permission denied (publickey)` | `ssh -v -i ~/.ssh/ishsoutside_deploy root@187.127.206.150` | `chmod 600 ~/.ssh/ishsoutside_deploy`; 키가 다르면 Hostinger hPanel에 해당 공개키 재등록 |
| `UNPROTECTED PRIVATE KEY FILE` | 개인키 권한 | `chmod 600 ~/.ssh/ishsoutside_deploy` |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | VPS 재설치/주소 변경 여부와 hPanel host key 확인 | 확인 후에만 `ssh-keygen -R 187.127.206.150`; 경고를 무시하지 않음 |
| SSH timeout | `ping`, hPanel console, VPS 방화벽/sshd | hPanel console에서 VPS/sshd 상태와 SSH 공개 포트 확인 |
| `rsync: command not found` | 로컬과 VPS의 rsync 설치 여부 | 해당 호스트에 `rsync` 설치 후 같은 명령 재실행 |
| `rsync ... Permission denied` | 서버 경로와 소유권 | root SSH인지, `/opt/ishsoutside`가 directory인지 확인; `chmod -R 777` 사용 금지 |
| rsync 뒤 운영 `.env` 없음 | 제외 옵션 또는 잘못된 수동 복사 여부 | backup/비밀 저장소에서 `.env` 복구하고 `chmod 600`; 다음부터 문서의 exclude 명령만 사용 |
| 운영 파일이 대량 삭제됨 | 잘못된 로컬 cwd에서 `--delete` 실행 | 더 이상 rsync하지 말고 Git 소스 재동기화; `.env`와 데이터는 backup에서 별도 복구. Docker volume은 source rsync 대상이 아님 |

### 7.2 로컬 검사와 build

| 증상 | 원인/확인 | 가장 빠른 해결 |
| --- | --- | --- |
| `corepack: command not found` | Node가 없거나 구버전 | Node 22 설치 후 `corepack enable` |
| Yarn lockfile 오류 | `package.json`과 `yarn.lock` 불일치 | 로컬에서 dependency를 정상 설치해 lockfile을 함께 commit; production에서 `--no-lockfile` 금지 |
| Prisma client type이 예전 상태 | schema 변경 후 generate 누락 | `cd client && corepack yarn prisma generate` 후 typecheck/build 재실행 |
| `.next/types/* 2.ts` duplicate identifier | 충돌 복사본인 생성 파일 | `find client/.next/types -maxdepth 1 -type f -name '* 2.ts' -delete`; 계속되면 `rm -rf client/.next` 후 build |
| TypeScript/ESLint 실패 | 실제 회귀 또는 generated cache | 첫 오류부터 수정. lint/typecheck를 `--no-verify`로 우회하지 않음 |
| `JavaScript heap out of memory` | build 메모리 부족 | 로컬 build로 먼저 코드 확인; VPS swap/RAM과 병렬 build 확인. 임시로 순차 `docker compose build web` 실행 |
| `no space left on device` | image/build cache 또는 log 증가 | `docker system df`, `du -xhd1 /var/lib/docker /var/log`; 사용하지 않는 dangling image/build cache만 정리. volume prune 금지 |
| Docker build가 오래된 코드를 사용 | cache 또는 sync 누락 | 서버 파일의 변경 시각/hash 확인 후 `docker compose build --no-cache web`은 원인이 cache로 확인된 경우에만 사용 |
| `docker: command not found` / daemon 오류 | Docker 미설치·중지 | VPS에서 Docker service 복구; local Docker는 로컬 검사에만 필요 |
| `docker compose`가 `.env` 변수를 찾지 못함 | `/opt/ishsoutside/.env` 누락/오타 | `.env.example`과 키 이름만 비교하고 비밀 저장소에서 값 복구; `docker compose config --quiet` |
| `Bake`/`buildx` 관련 warning | 최적화 plugin 없음 | build가 계속되면 경고이며 실패 아님. 실제 exit code를 확인 |

### 7.3 Prisma와 PostgreSQL migration

| 증상 | 의미 | 가장 빠른 해결 |
| --- | --- | --- |
| Prisma `P1001` | PostgreSQL 연결 불가 | `docker compose ps postgres`; `.env`의 DB 이름/사용자/비밀번호와 Compose hostname `postgres` 확인 |
| Prisma `P1000` | DB 인증 실패 | 운영 `.env`와 기존 volume 생성 당시 credential 확인. 비밀번호를 즉석에서 초기화하지 않음 |
| `P3005` database is not empty | migration history 없이 기존 schema 존재 | 신규 서버 baseline 절차가 필요. production에서 임의 `migrate resolve` 금지; 인수인계서의 데이터 이력부터 확인 |
| `P3009` failed migrations found | 이전 migration 실패 기록 | `_prisma_migrations`와 migrate log 확인, backup 확보 후 forward-fix 또는 검증된 resolve 수행 |
| `P3018` migration failed | SQL/data constraint 충돌 | Web 재시작 중단, 오류 row와 SQL 확인, migration을 수정한 새 forward migration 작성. DB restore 여부 판단 |
| unique constraint 추가 실패 | 기존 중복 데이터 | 중복 query로 대상 식별·승인 후 정리하고 migration 재실행; 데이터를 자동 삭제하지 않음 |
| column/table does not exist | migration 미적용 또는 구버전 이미지 | `docker compose run --rm migrate` 성공 후 Web 재생성 |
| schema drift | 수동 DB 변경 또는 `db push` 이력 | backup 후 실제 schema와 migrations 비교; production `prisma db push` 금지 |
| migrate container `Exited (0)` | 일회성 작업 완료 | 정상. 계속 띄우지 않음 |
| migration 후 구버전 롤백이 실패 | DB와 구버전 code 비호환 | 이미지 rollback을 반복하지 말고 호환되는 forward-fix 배포 또는 같은 시각 DB backup 복구 계획 실행 |

### 7.4 Docker service

| 증상 | 우선 확인 | 가장 빠른 해결 |
| --- | --- | --- |
| `web unhealthy` | `docker compose logs web migrate`; `/api/health` | DB/migration/env 오류부터 해결 후 `docker compose up -d --no-deps --force-recreate web` |
| Web restart loop | 최초 runtime exception, env 누락 | `docker compose logs --tail=300 web`; 정확한 원인 수정 후 image 재build |
| `realtime unhealthy` | realtime log, `INTERNAL_API_SECRET`, Web health, Redis | Web/Redis를 먼저 healthy로 만들고 secret 양쪽 일치 확인 후 realtime 재생성 |
| `postgres unhealthy` | disk, volume, `pg_isready`, Postgres log | disk부터 확보; volume 삭제 없이 Postgres log 원인 해결 |
| `redis unhealthy` | `docker compose logs redis`, disk | Redis 재시작 전 AOF/disk 확인; volume 삭제 금지 |
| MinIO가 시작 안 됨 | `docker compose logs minio minio-init`, S3 key, disk | credential/volume mount 수정 후 `docker compose up -d minio minio-init` |
| `minio-init Exited (0)` | bucket 생성 작업 완료 | 정상 |
| `port is already allocated` | `ss -ltnp`, 중복 Compose project/container | 기존 운영 container를 확인하고 잘못 띄운 중복 stack만 중지. 프로젝트명 변경 금지 |
| service가 dependency를 기다림 | dependency health 또는 oneshot 실패 | `docker compose ps -a`와 선행 service log 확인 |
| Docker pull rate/network 실패 | registry/network | 기존 image를 지우지 말고 연결 복구 후 pull/build 재시도 |
| 컨테이너 이름/볼륨이 새로 생김 | Compose project명이 바뀜 | 즉시 중단하고 `name: igwak-portal` 복구. 새 빈 volume에 서비스를 계속 쓰지 않음 |

### 7.5 HTTP, Caddy, DNS, TLS

| 증상 | 우선 확인 | 가장 빠른 해결 |
| --- | --- | --- |
| 502/503 | `docker compose ps`; Caddy/Web/realtime log | upstream service를 healthy로 만든 뒤 Caddy reload |
| 404/잘못된 route | Caddyfile과 Next route, 요청 hostname | `caddy validate`; `/socket.io/*`만 realtime으로 가는지 확인 |
| TLS certificate 오류 | DNS A/AAAA, 80/443, Caddy log | 도메인이 VPS를 가리키고 포트가 열렸는지 수정 후 Caddy가 자동 재발급하도록 유지 |
| redirect loop | `NEXT_PUBLIC_APP_URL`, Caddy redirect, proxy header | public URL은 `https://ishsoutside.com`; 중복 redirect 제거 |
| `www`만 실패 | DNS와 Caddy host block | `www` DNS가 VPS를 가리키는지와 본 도메인 redirect 확인 |
| Caddyfile reload 실패 | syntax/config 오류 | 기존 Caddy process는 유지하고 파일을 수정한 뒤 `caddy validate`, 그 다음 reload |
| `/api/health` 500 | Web log와 `database` field | DB/migration/runtime env 해결; Caddy 재시작으로 숨기지 않음 |

### 7.6 브라우저, UI와 PWA

| 증상 | 원인/확인 | 가장 빠른 해결 |
| --- | --- | --- |
| 화면이 이전 버전 | browser cache, service worker, 실제 image tag | private window에서 확인; Web image가 새로 생성됐는지 확인 후 hard reload |
| `ChunkLoadError` | 배포 전 HTML과 새 chunk 혼재 | 새 Web이 healthy인지 확인하고 새로고침. 반복되면 build/cache header와 service worker 갱신 확인 |
| 새 `NEXT_PUBLIC_*` 값이 안 보임 | build-time env | `.env` 수정 뒤 Web을 반드시 재build/recreate |
| manifest 이름/아이콘이 예전 값 | PWA cache 또는 파일 미배포 | 공개 manifest 직접 curl, Web rebuild, service worker 갱신 확인 |
| hydration/runtime error | server/client render 차이 | browser console과 Web log의 첫 stack trace로 수정 후 재build |
| B-side에서 `보안 모드를 확인하는 중` 고정 | `/api/platform` 실패 또는 setting migration 누락 | endpoint와 Web log 확인, migration 적용 후 Web 재생성 |

### 7.7 메시지, 알림, 업로드와 인증

| 증상 | 우선 확인 | 가장 빠른 해결 |
| --- | --- | --- |
| 페이지는 열리나 채팅만 불가 | Socket.IO handshake, realtime log, Caddy route | Web/realtime secret과 `WEB_ORIGIN`, `/socket.io/*` 프록시 확인 후 realtime 재생성 |
| handshake 400 | origin, EIO version, proxy path | `WEB_ORIGIN=https://ishsoutside.com`, Socket.IO client/server 호환성과 path 확인 |
| handshake 502 | realtime down 또는 Caddy upstream | realtime을 healthy로 만든 뒤 Caddy reload |
| 메시지는 보내지나 실시간 수신 안 됨 | Redis와 socket room join | realtime/Redis log 확인, 두 service 재생성 전 Web API health 확인 |
| 첨부 upload/download 실패 | MinIO health, bucket, S3 key, 20MB 제한 | `minio`/`minio-init` log와 private bucket 확인; public bucket으로 바꾸지 않음 |
| 첨부 record만 있고 object 없음 | DB와 object backup 시점 불일치 | 같은 timestamp의 PostgreSQL/MinIO backup pair로 복구 |
| 로그인 전체 실패 | Web log, DB, session/env | session secret/DB를 확인. secret을 임의 회전하면 기존 세션이 모두 무효화됨 |
| env의 admin 초기 비밀번호가 반영 안 됨 | 기존 admin row가 이미 존재 | seed env는 최초 생성에만 적용됨. 승인된 관리자 계정 복구 절차 사용 |
| 정상 요청이 429 | rate limit 소진 | 자동 반복을 중지하고 제한 시간이 지난 뒤 최소 횟수만 재검사 |
| 알림 클릭/그룹 읽음만 실패 | 해당 API response와 Web log | 실제 session으로 한 번 재현하고 실패 endpoint를 수정; notification 데이터를 직접 삭제하지 않음 |

### 7.8 성능과 용량

| 증상 | 확인 | 가장 빠른 해결 |
| --- | --- | --- |
| stress test에 5xx/network error | 같은 시각 Web/Caddy/Postgres log | 배포 완료 처리하지 말고 원인 수정 또는 코드 rollback |
| 5xx는 없지만 p95 급증 | CPU/RAM/IO, DB slow query, cold start | 1회 warm-up 후 같은 120/12 조건으로 재측정; 계속되면 최근 diff와 query 확인 |
| VPS CPU 100% | `docker stats`, build 실행 여부 | build 종료를 기다리고 service별 사용량 확인; 무작정 전체 restart 금지 |
| 디스크 90% 이상 | `df -h`, `docker system df`, backup 크기 | 오래된 정책 밖 backup과 dangling build cache를 검토 후 정리; 최신 backup/volume 삭제 금지 |
| inode 100% | `df -i`, 작은 파일 다량 생성 경로 | 원인 cache/log만 정리하고 volume 무단 삭제 금지 |
| log가 디스크를 채움 | Docker log 크기와 journald | 원인 loop를 먼저 멈추고 log rotation 설정; 실행 중 log file을 직접 truncate하지 않음 |

## 8. 가장 빠른 코드 롤백

Migration이 없거나 DB 변경이 이전 code와 호환될 때만 이미지 rollback을 사용합니다.

```bash
ssh -i ~/.ssh/ishsoutside_deploy root@187.127.206.150 <<'REMOTE'
set -eu
cd /opt/ishsoutside
docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' | grep 'rollback-'

# TIMESTAMP를 위 목록에서 검증한 값으로 바꾼 뒤 실행
docker image tag igwak-portal-web:rollback-TIMESTAMP igwak-portal-web:latest
docker image tag igwak-portal-realtime:rollback-TIMESTAMP igwak-portal-realtime:latest
docker compose up -d --no-deps --force-recreate web realtime
docker compose ps
REMOTE
```

Migration이 실행된 배포는 이미지부터 되돌리지 않습니다. 새 code가 쓴 데이터가 구버전 schema/code와 맞지 않을 수 있으므로 [DB 복구 절차](./DEPLOYMENT_HANDOVER.md#11-복구)에 따라 같은 시각의 DB·MinIO backup pair와 호환성을 확인합니다.

## 9. 절대 하지 않는 명령·행동

- `docker compose down -v`, `docker volume prune`, 운영 volume 수동 삭제
- production에서 `prisma db push`, `prisma migrate reset`
- 저장소 루트 확인 없이 `rsync --delete`
- 로컬 `.env`를 운영에 복사하거나 운영 `.env`를 Git/채팅/log에 출력
- migration 오류를 이해하지 않고 `prisma migrate resolve`
- DB backup 없이 destructive migration
- 원인을 보지 않고 전체 stack 반복 restart
- `igwak-portal` Compose 이름 또는 기존 volume 이름 변경
- MinIO bucket public 전환
- 실제 사용자 계정으로 자동화 메시지·알림·글 생성
- disk 확보 목적으로 최신 backup 또는 Docker volume 삭제
- 타인의 local 변경을 `git reset --hard`, `git clean`, `git checkout --`로 제거

## 10. 배포 기록 템플릿

배포가 끝나면 issue, release note 또는 운영 일지에 아래만 남깁니다. 비밀값과 실제 계정 정보는 넣지 않습니다.

```text
배포 시각(KST):
배포 commit:
담당자:
경로: A Web / B Web+realtime / C Migration / D Infra
변경 요약:
backup 성공 시각:
rollback tag:
migration 목록/결과:
컨테이너 health:
/api/health:
Socket.IO handshake:
stress 120/12 결과:
실제 기능 smoke test:
남은 관찰 항목:
```

## 11. 더 자세한 문서

- 최초 VPS 구축, env 목록, backup/restore: [DEPLOYMENT_HANDOVER.md](./DEPLOYMENT_HANDOVER.md)
- 서비스와 데이터 흐름: [ARCHITECTURE.md](./ARCHITECTURE.md)
- 기준 성능과 과거 안정성 점검: [STABILITY_REPORT.md](./STABILITY_REPORT.md)
- 기능, 로컬 실행, 개발 규칙: [README.md](./README.md)

운영 주소, SSH, 서비스명, backup unit, Compose 구성 또는 배포 경로가 바뀌면 이 파일과 `DEPLOYMENT_HANDOVER.md`를 같은 commit에서 함께 갱신합니다.
