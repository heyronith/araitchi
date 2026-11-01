#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATIC="$ROOT/.next/static"

if [[ ! -d "$STATIC" ]]; then
  echo "Missing .next/static — run pnpm build first" >&2
  exit 1
fi

# Fail if client bundles contain raw OpenRouter key prefixes.
if rg -l --hidden -g '!*LICENSE*' 'sk-or-' "$STATIC" >/dev/null 2>&1; then
  echo "Secret leak: found sk-or- in client bundle" >&2
  rg -n --hidden -g '!*LICENSE*' 'sk-or-' "$STATIC" | head -20 >&2 || true
  exit 1
fi

# Fail if client code appears to read openrouter_api_key secret values
# (status booleans / whitelist names alone are OK; block getSecret-style patterns).
if rg -n --hidden 'getSecret\([^\)]*openrouter_api_key|openrouter_api_key["'\'']\s*,\s*["'\'']sk-' "$STATIC" >/dev/null 2>&1; then
  echo "Secret leak: client bundle appears to read openrouter_api_key values" >&2
  exit 1
fi

echo "Secret leak check passed"
