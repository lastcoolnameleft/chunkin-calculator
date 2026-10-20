#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ $# -gt 0 ]]; then
  if [[ $# -ne 1 || "$1" != --prod-snapshot ]]; then
    echo "Usage: $0 [--prod-snapshot]" >&2
    exit 1
  fi
  if [[ ! -f data/prod-snapshot/tracker.db ]]; then
    echo "Production snapshot not found at data/prod-snapshot/tracker.db. Run ./scripts/pull-prod-snapshot.sh first." >&2
    exit 1
  fi
  export DB_PATH="$PWD/data/prod-snapshot/tracker.db"
  echo "Using local production snapshot: $DB_PATH"
fi

if [[ -f .env ]]; then
  exec node --env-file=.env scripts/run-local.js
fi
exec node scripts/run-local.js
