#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATIC="${ARAITCHI_STATIC_DIR:-$ROOT/.next/static}"

if [[ ! -d "$STATIC" ]]; then
  echo "Missing .next/static — run pnpm build first (or set ARAITCHI_STATIC_DIR)" >&2
  exit 2
fi

# Portable recursive search. Exit codes:
#   0 = matches found
#   1 = no matches
#  ≥2 = error (missing tool, I/O, etc.)
grep_matches() {
  local pattern="$1"
  local out
  set +e
  out="$(grep -rIl --exclude='*LICENSE*' -- "$pattern" "$STATIC" 2>&1)"
  local code=$?
  set -e
  if [[ $code -ge 2 ]]; then
    echo "Secret leak search failed (grep exit $code): $out" >&2
    exit 2
  fi
  if [[ $code -eq 0 ]]; then
    echo "$out"
    return 0
  fi
  return 1
}

if matches="$(grep_matches 'sk-or-')"; then
  echo "Secret leak: found sk-or- in client bundle" >&2
  echo "$matches" | head -20 >&2
  exit 1
fi

if matches="$(grep_matches 'getSecret([^)]*openrouter_api_key\|openrouter_api_key["'"'"'][[:space:]]*,[[:space:]]*["'"'"']sk-')"; then
  echo "Secret leak: client bundle appears to read openrouter_api_key values" >&2
  echo "$matches" | head -20 >&2
  exit 1
fi

echo "Secret leak check passed"
