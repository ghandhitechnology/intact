#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/client"
MIGRATIONS_DIR="$CLIENT_DIR/prisma/migrations"
invalid=0
migration_count=0

while IFS= read -r -d '' directory; do
  name="$(basename "$directory")"
  migration_count=$((migration_count + 1))

  if [[ ! "$name" =~ ^[0-9]{14}_[a-z0-9_]+$ ]]; then
    printf 'error: invalid migration directory name: %s\n' "$name" >&2
    invalid=1
  fi

  if [[ ! -f "$directory/migration.sql" ]]; then
    printf 'error: migration is missing migration.sql: %s\n' "$name" >&2
    invalid=1
  fi

  while IFS= read -r -d '' extra; do
    printf 'error: unexpected file in migration directory: %s\n' "${extra#$ROOT_DIR/}" >&2
    invalid=1
  done < <(find "$directory" -maxdepth 1 -type f ! -name 'migration.sql' -print0)
done < <(find "$MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d -print0)

if [[ "$migration_count" -eq 0 ]]; then
  printf 'error: no Prisma migrations found in %s\n' "$MIGRATIONS_DIR" >&2
  invalid=1
fi

if [[ ! -f "$MIGRATIONS_DIR/migration_lock.toml" ]] || ! grep -Eq '^provider[[:space:]]*=[[:space:]]*"postgresql"' "$MIGRATIONS_DIR/migration_lock.toml"; then
  printf 'error: migration_lock.toml must declare the postgresql provider.\n' >&2
  invalid=1
fi

if [[ "$invalid" -ne 0 ]]; then
  exit 1
fi

printf 'Validated %d migration directories.\n' "$migration_count"

if [[ -n "${DATABASE_URL:-}" ]]; then
  printf 'Applying migrations to the verification database.\n'
  yarn --cwd "$CLIENT_DIR" prisma migrate deploy
else
  printf 'DATABASE_URL is unset; skipped applying migrations (CI supplies an isolated PostgreSQL database).\n'
fi
