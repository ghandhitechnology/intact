#!/usr/bin/env bash
# 인텍트 Cloud Agent 개발 환경 install 단계.
# 체크아웃된 소스에 의존하는 준비 작업을 수행하며, 반복 실행해도 안전하도록(idempotent) 작성했습니다.
# - 시스템 패키지(PostgreSQL 16, Redis, python3-venv)와 MinIO 바이너리 설치
# - client / server/chat 의존성 설치와 Prisma client 생성
# - Web 프로덕션 빌드(standalone) 및 realtime TypeScript 빌드
# 런타임 서비스 기동과 migration 은 start.sh 에서 수행합니다.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/client"
CHAT_DIR="$ROOT_DIR/server/chat"

log() { printf '\n[install] %s\n' "$1"; }

# 1) 시스템 패키지 (PostgreSQL / Redis / python venv / 다운로드 도구)
log "시스템 패키지 확인 및 설치"
if ! command -v psql >/dev/null 2>&1 || ! command -v redis-server >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    postgresql postgresql-contrib redis-server python3-venv python3-pip ca-certificates wget
else
  # verify.sh 의 riro-bridge 단계에 python venv 가 필요하므로 보장합니다.
  if ! python3 -m venv --help >/dev/null 2>&1; then
    sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-venv python3-pip
  fi
fi

# 2) MinIO(S3 호환 오브젝트 스토리지) 서버/클라이언트 바이너리
log "MinIO 바이너리 확인"
if ! command -v minio >/dev/null 2>&1; then
  wget -q https://dl.min.io/server/minio/release/linux-amd64/minio -O /tmp/minio
  chmod +x /tmp/minio && sudo mv /tmp/minio /usr/local/bin/minio
fi
if ! command -v mc >/dev/null 2>&1; then
  wget -q https://dl.min.io/client/mc/release/linux-amd64/mc -O /tmp/mc
  chmod +x /tmp/mc && sudo mv /tmp/mc /usr/local/bin/mc
fi

# 3) Yarn 1.22.22 (corepack)
log "corepack / yarn 활성화"
corepack enable
corepack prepare yarn@1.22.22 --activate

# 4) 로컬 개발용 .env 생성 (없을 때만 — 재실행 시 비밀값 유지)
#    운영 비밀값을 절대 사용하지 않으며, 무작위 값을 새로 생성합니다.
if [ ! -f "$CLIENT_DIR/.env" ]; then
  log "client/.env 생성 (개발용 무작위 비밀값)"
  SESSION_SECRET="$(openssl rand -hex 32)"
  PORTAL_ENCRYPTION_KEY="$(openssl rand -hex 16)"
  INTERNAL_API_SECRET="$(openssl rand -hex 32)"
  cat > "$CLIENT_DIR/.env" <<EOF
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_REALTIME_URL=http://localhost:3001
NEXT_PUBLIC_PORTAL_DEMO_MODE=false
PORTAL_DEMO_MODE=false

DATABASE_URL=postgresql://igwak:igwak_dev_password@127.0.0.1:5432/igwak?schema=public
SESSION_SECRET=${SESSION_SECRET}
PORTAL_ENCRYPTION_KEY=${PORTAL_ENCRYPTION_KEY}
INTERNAL_API_SECRET=${INTERNAL_API_SECRET}

ADMIN_INITIAL_ID=admin
ADMIN_INITIAL_PASSWORD=admin_dev_password_123
ADMIN_INITIAL_NICKNAME=관리자
RIRO_AUTH_MODE=OFF
RIRO_BRIDGE_URL=http://127.0.0.1:8765
RIRO_BRIDGE_SECRET=
TRUST_PROXY=false

REDIS_URL=redis://127.0.0.1:6379
OUTBOX_ENABLED=false
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.invalid
S3_ENDPOINT=http://127.0.0.1:9000
S3_BUCKET=igwak-uploads
S3_ACCESS_KEY=igwak-storage
S3_SECRET_KEY=igwak_dev_storage_password
S3_REGION=auto
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
CLAMAV_TIMEOUT_MS=600000
ATTACHMENT_POLL_MS=1500
ATTACHMENT_LEASE_MS=300000
ATTACHMENT_MAX_ATTEMPTS=3
ATTACHMENT_UPLOAD_CLEANUP_MS=900000
EOF
fi

# 5) 의존성 설치 + Prisma client
log "client 의존성 설치"
( cd "$CLIENT_DIR" && corepack yarn install --frozen-lockfile )
log "Prisma client 생성"
( cd "$CLIENT_DIR" && corepack yarn prisma generate )

log "realtime(server/chat) 의존성 설치"
( cd "$CHAT_DIR" && corepack yarn install --frozen-lockfile )

# 6) 빌드 (dev 서버는 앱 CSP 가 unsafe-eval 을 허용하지 않아 HMR 이 막히므로,
#    운영과 동일하게 standalone 프로덕션 빌드를 사용합니다.)
log "Web 프로덕션 빌드"
( cd "$CLIENT_DIR" && corepack yarn build )

log "standalone 실행 디렉터리 준비 (static/public 복사)"
(
  cd "$CLIENT_DIR"
  cp -r public .next/standalone/public
  rm -rf .next/standalone/.next/static
  mkdir -p .next/standalone/.next
  cp -r .next/static .next/standalone/.next/static
)

log "realtime TypeScript 빌드"
( cd "$CHAT_DIR" && corepack yarn build )

log "install 완료"
