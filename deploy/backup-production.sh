#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/ishsoutside}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ishsoutside}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

cd "$APP_DIR"
docker compose exec -T postgres pg_dump \
  --username "${POSTGRES_USER:-igwak}" \
  --dbname "${POSTGRES_DB:-igwak}" \
  --format=custom \
  | gzip -9 > "$BACKUP_DIR/postgres-$STAMP.dump.gz"

docker run --rm \
  --volume igwak-portal_object_data:/data:ro \
  --volume "$BACKUP_DIR:/backup" \
  alpine:3.20 \
  tar -C /data -czf "/backup/uploads-$STAMP.tar.gz" .

chmod 600 "$BACKUP_DIR/postgres-$STAMP.dump.gz" "$BACKUP_DIR/uploads-$STAMP.tar.gz"
find "$BACKUP_DIR" -type f \( -name 'postgres-*.dump.gz' -o -name 'uploads-*.tar.gz' \) \
  -mtime "+$RETENTION_DAYS" -delete
