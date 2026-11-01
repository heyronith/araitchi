# Araitchi architecture (Task 1)

## Stack

- **Next.js** App Router + TypeScript (`strict`) under `src/`
- **Tailwind CSS** + **shadcn/ui** (neutral, CSS variables) + **next-themes**
- **SQLite** via `better-sqlite3` + **Drizzle ORM**
- Planned (installed, not wired): `@assistant-ui/react`, `ai`, `@ai-sdk/react`, `@openrouter/ai-sdk-provider`

## Folders

```
src/app/                 routes, layout, API handlers
src/components/ui/       shadcn primitives
src/components/shell/    app chrome (sidebar, top bar, settings)
src/lib/server/          server-only modules (DB, secrets, paths, security)
drizzle/                 SQL migrations
tests/                   Vitest unit tests
e2e/                     Playwright end-to-end tests
docs/                    architecture + task briefs
```

## Data locations

| Item | Location |
| --- | --- |
| App data dir | `ARAITCHI_DATA_DIR` or `envPaths('araitchi').data` |
| Database | `<dataDir>/app.db` (WAL) |
| Master key | `<dataDir>/master.key` (32 random bytes) |

Tables: `settings` (JSON values), `secrets` (AES-256-GCM ciphertext + iv + tag).

## Security model

1. **Localhost binding** — `next dev` / `next start` use `-H 127.0.0.1` so the process is not reachable from other hosts.
2. **Origin guard** — mutating routes call `assertLocalOrigin()`; non-local `Origin` → 403.
3. **Encrypted secrets** — whitelist-only names; values never logged or returned to the client.
4. **Node runtime** — DB routes set `export const runtime = 'nodejs'` (native SQLite).
