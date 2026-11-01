#!/usr/bin/env bash
# Plants a fake sk-or-test string and asserts check-secrets.sh fails.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

STATIC_SRC="$ROOT/.next/static"
if [[ ! -d "$STATIC_SRC" ]]; then
  echo "Missing .next/static — run pnpm build first" >&2
  exit 2
fi

# Copy a shallow subset (or the whole tree) so the planted string is searchable.
cp -R "$STATIC_SRC" "$TMP/static"
printf 'planted sk-or-test leak marker\n' > "$TMP/static/__leak_probe.js"

set +e
ARAITCHI_STATIC_DIR="$TMP/static" bash "$ROOT/scripts/check-secrets.sh"
code=$?
set -e

if [[ $code -eq 0 ]]; then
  echo "Self-test FAILED: check-secrets.sh did not detect planted sk-or-test" >&2
  exit 1
fi
if [[ $code -ge 2 ]]; then
  echo "Self-test FAILED: check-secrets.sh errored (exit $code)" >&2
  exit 1
fi

echo "Secret leak self-test passed (script correctly exited $code)"
