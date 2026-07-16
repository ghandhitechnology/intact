#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/client"
CHAT_DIR="$ROOT_DIR/server/chat"
RIRO_DIR="$ROOT_DIR/server/riro-bridge"
MODERATION_DIR="$ROOT_DIR/server/codex-moderation"

step() {
  printf '\n==> %s\n' "$1"
  shift
  "$@"
}

node_major="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$node_major" != "22" ]]; then
  printf 'error: verification requires Node.js 22; found %s. Run `nvm use` from %s.\n' "$(node --version)" "$ROOT_DIR" >&2
  exit 1
fi

if ! command -v yarn >/dev/null 2>&1; then
  printf 'error: Yarn 1.22.22 is required. Run `corepack enable && corepack prepare yarn@1.22.22 --activate`.\n' >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  printf 'error: python3 is required for the Riro bridge checks.\n' >&2
  exit 1
fi

step "Prisma schema validation" env \
  DATABASE_URL="${DATABASE_URL:-postgresql://verify:verify@localhost:5432/intact_verify?schema=public}" \
  yarn --cwd "$CLIENT_DIR" prisma:validate
step "Migration layout and deploy check" bash "$ROOT_DIR/scripts/check-migrations.sh"
step "Client lint" yarn --cwd "$CLIENT_DIR" lint
step "Next.js type generation" yarn --cwd "$CLIENT_DIR" next typegen
step "Client typecheck" yarn --cwd "$CLIENT_DIR" typecheck
step "Client tests" yarn --cwd "$CLIENT_DIR" test
step "Next production build" yarn --cwd "$CLIENT_DIR" build
step "Realtime TypeScript build" yarn --cwd "$CHAT_DIR" build

step "Moderation sidecar syntax" bash -c '
  set -e
  while IFS= read -r -d "" file; do
    node --check "$file"
  done < <(find "$1" -type f -name "*.mjs" ! -name "* 2*" -print0)
' _ "$MODERATION_DIR"

step "Python dependency consistency" python3 -m pip check
step "Riro bridge tests" bash -c 'cd "$1" && python3 -m unittest -v test_main.py' _ "$RIRO_DIR"

printf '\nAll verification gates passed.\n'
