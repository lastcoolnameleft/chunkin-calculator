#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")/.."

if [[ -e data/prod-snapshot || -L data/prod-snapshot ]]; then
  echo "data/prod-snapshot already exists. Stop the local server and move the old snapshot before importing a new one." >&2
  exit 1
fi
command -v scp >/dev/null || { echo "scp is required." >&2; exit 1; }

echo "This copies production's tracker.db, tracker.db-wal, and tracker.db-shm from dh."
echo "It does not stop or start production. Keep production stopped until the copy finishes."
if ! read -r -p "Have you stopped production and the local server? [y/N] " answer ||
  [[ "$answer" != y && "$answer" != Y && "$answer" != yes && "$answer" != YES ]]; then
  echo "Snapshot cancelled; no files were copied." >&2
  exit 1
fi

mkdir -p data
staging="$(mktemp -d data/.prod-snapshot.XXXXXX)"
cleanup() {
  if [[ -n "$staging" ]]; then
    rm -f "$staging/tracker.db" "$staging/tracker.db-wal" "$staging/tracker.db-shm"
    rmdir "$staging"
  fi
}
trap cleanup EXIT

if ! scp dh:/data/chunkin-calculator/prod/tracker.db \
  dh:/data/chunkin-calculator/prod/tracker.db-wal \
  dh:/data/chunkin-calculator/prod/tracker.db-shm \
  "$staging/"; then
  echo "Snapshot copy failed; no snapshot was installed. Check the error above before retrying." >&2
  exit 1
fi
if [[ -e data/prod-snapshot || -L data/prod-snapshot ]]; then
  echo "data/prod-snapshot appeared during the copy; refusing to overwrite it." >&2
  exit 1
fi
mv "$staging" data/prod-snapshot
staging=''

echo "Production snapshot copied to data/prod-snapshot. You can restart production now."
echo "Start the local preview with:"
echo "./scripts/run-local.sh --prod-snapshot"
