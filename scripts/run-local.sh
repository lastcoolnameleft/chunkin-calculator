#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  exec node --env-file=.env scripts/run-local.js
fi
exec node scripts/run-local.js
