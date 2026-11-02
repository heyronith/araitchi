#!/usr/bin/env bash
# Fresh-clone install for macOS/Linux: Node ≥22, git, corepack, pnpm install + build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MIN_NODE=22

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found." >&2
  echo "Install Node.js ${MIN_NODE}+ from https://nodejs.org/ and re-run this script." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt "$MIN_NODE" ]]; then
  echo "Node.js ${MIN_NODE}+ is required (found $(node -v))." >&2
  echo "Upgrade Node.js from https://nodejs.org/ and re-run this script." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required but was not found." >&2
  echo "Install git (https://git-scm.com/) and re-run this script." >&2
  exit 1
fi

echo "→ Enabling corepack…"
corepack enable

echo "→ Installing dependencies (pnpm install)…"
if ! pnpm install; then
  echo "→ pnpm install failed; retrying once…"
  pnpm install
fi

echo "→ Building (pnpm build)…"
pnpm build

cat <<'EOF'

Install complete.

Start the app with:
  pnpm start

(Use `pnpm start -- --no-open` to skip opening the browser.)
EOF
