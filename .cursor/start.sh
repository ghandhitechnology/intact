#!/usr/bin/env bash
# 인텍트 Cloud Agent 개발 환경 start 단계.
# 매 부팅마다 실행되며, 의존 서비스(PostgreSQL/Redis/MinIO)를 기동하고
# 데이터베이스 migration 을 적용한 뒤 반환합니다(장시간 실행 서버는 terminals 에서 구동).
# 이미 떠 있는 서비스는 다시 띄우지 않도록 idempotent 하게 작성했습니다.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/client"

log() { printf '\n[start] %s\n' "$1"; }

# 1) PostgreSQL 16 (Debian 클러스터 main) 기동
log "PostgreSQL 기동 확인"
if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  sudo pg_ctlcluster 16 main start || true
  for _ in $(seq 1 30); do
    pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && break
    sleep 1
  done
fi

# 2) igwak role / database 보장
log "PostgreSQL role/db 보장"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='igwak') THEN
    CREATE ROLE igwak LOGIN PASSWORD 'igwak_dev_password';
  END IF;
END $$;
SQL
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='igwak'" | grep -q 1 \
  || sudo -u postgres createdb -O igwak igwak
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE igwak TO igwak;" >/dev/null

# 3) Redis 기동
log "Redis 기동 확인"
if ! redis-cli ping >/dev/null 2>&1; then
  redis-server --daemonize yes --appendonly no
fi

# 4) MinIO 기동 + 버킷 보장
log "MinIO 기동 확인"
mkdir -p "$HOME/minio-data"
if ! curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; then
  MINIO_ROOT_USER=igwak-storage MINIO_ROOT_PASSWORD=igwak_dev_storage_password \
    nohup minio server "$HOME/minio-data" --console-address ":9001" \
    > "$HOME/minio.log" 2>&1 &
  for _ in $(seq 1 30); do
    curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1 && break
    sleep 1
  done
fi
mc alias set localdev http://127.0.0.1:9000 igwak-storage igwak_dev_storage_password >/dev/null 2>&1 || true
mc mb --ignore-existing localdev/igwak-uploads >/dev/null 2>&1 || true
mc anonymous set none localdev/igwak-uploads >/dev/null 2>&1 || true

# 5) 데이터베이스 migration 적용
log "Prisma migrate deploy"
( cd "$CLIENT_DIR" && corepack yarn prisma migrate deploy )

log "start 완료 — Web/realtime 서버는 terminals 에서 구동됩니다."
