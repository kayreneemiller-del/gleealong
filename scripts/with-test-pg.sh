#!/usr/bin/env bash
# Runs the DB tests against a throwaway local Postgres (no Docker, no Supabase CLI needed).
# If TEST_DATABASE_URL is already set, uses that instead and just runs vitest.
set -euo pipefail

if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
  exec npx vitest run tests/db
fi

PGBIN="${PGBIN:-$(dirname "$(ls /usr/lib/postgresql/*/bin/initdb 2>/dev/null | sort -V | tail -1)")}"
[[ -x "$PGBIN/initdb" ]] || { echo "No local Postgres found. Set PGBIN or TEST_DATABASE_URL."; exit 1; }

PORT="${TEST_PG_PORT:-54329}"
DIR="$(mktemp -d)"
RUN=()
if [[ "$(id -u)" == "0" ]]; then          # Postgres refuses to run as root
  chown postgres "$DIR"
  RUN=(runuser -u postgres --)
fi

cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT

"${RUN[@]}" "$PGBIN/initdb" -D "$DIR/data" -A trust -U postgres >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1" -l "$DIR/log" -w start >/dev/null

export TEST_DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/postgres"
npx vitest run tests/db
