# Araitchi

Araitchi is a local-first, self-hosted AI research workspace. It runs as a Next.js app on your machine; you bring your own OpenRouter API key. A team of models from different labs will help with literature review, hypotheses, and experiment design — each research project is a folder on disk.

**Status:** pre-alpha, Task 2 of 9 (OpenRouter + solo chat).

## Requirements

- Node.js 22 LTS (see `.nvmrc`)
- [pnpm](https://pnpm.io) via Corepack (`corepack enable`)

## Quick start

```bash
corepack enable
pnpm install
pnpm dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

`dev` and `start` bind to **127.0.0.1 only** (not `0.0.0.0`) because the app stores API keys on disk. Binding to localhost prevents other devices on your network from reaching those endpoints.

### Connect OpenRouter

1. Open **Settings → Keys**.
2. Prefer **Connect with OpenRouter** (OAuth PKCE), or paste an API key manually and Save.
3. Pick a model in the composer (catalog refreshes from OpenRouter; favourites + default live in Settings → Models).
4. Chat. **Token usage and $ cost are billed to your OpenRouter account.**

### Manual smoke (not CI)

```bash
OPENROUTER_API_KEY=sk-or-... pnpm smoke:openrouter
```

Lists models, sends a tiny prompt to a cheap model, prints reply + cost.

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Next.js dev server on `127.0.0.1:3000` |
| `pnpm build` / `pnpm start` | Production build / server (localhost only) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript (`tsc --noEmit`) |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Playwright (Chromium) + mock OpenRouter |
| `pnpm check:secrets` | Fail if client bundle leaks `sk-or-` |
| `pnpm smoke:openrouter` | Live OpenRouter smoke (manual) |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle migrations |

## Where data is stored

App data lives in an OS-correct directory (override with `ARAITCHI_DATA_DIR`):

| OS | Default path |
| --- | --- |
| macOS | `~/Library/Application Support/araitchi` |
| Windows | `%APPDATA%\araitchi` |
| Linux | `~/.local/share/araitchi` |

Contents include `app.db` (SQLite) and `master.key` (AES-256-GCM master key for secrets).

## Security notes

- Server listens on localhost only so API keys are not exposed on the LAN.
- Secrets are encrypted with AES-256-GCM; the master key is `master.key` with mode `0600` where the OS supports it.
- **Never share or commit `master.key`.** Anyone with that file and `app.db` can decrypt your keys.
- Mutating API routes reject non-local `Origin` headers (exact app port only).
- Secret values are never returned to the browser — only boolean “set / not set” status.
- Optional: point tests at a mock with `ARAITCHI_OPENROUTER_BASE_URL`.

## Reset

Delete the data directory (see table above, or your `ARAITCHI_DATA_DIR`). The next launch recreates an empty database and a new master key.

## License

MIT — Copyright (c) 2026 heyronith
