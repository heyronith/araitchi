# Araitchi architecture

## Stack

- **Next.js** App Router + TypeScript (`strict`) under `src/`
- **Tailwind CSS** + **shadcn/ui** (neutral, CSS variables) + **next-themes**
- **SQLite** via `better-sqlite3` + **Drizzle ORM** (two databases)
- **OpenRouter** via `@openrouter/ai-sdk-provider` + AI SDK `streamText`
- **Chat UI** via `@ai-sdk/react` + `@assistant-ui/react-ai-sdk` transport

## Folders

```
src/app/                      routes, layout, API handlers
src/components/ui/            shadcn primitives
src/components/shell/         app chrome (sidebar, top bar, settings, memory, open-folder)
src/components/chat/          solo chat panel, model picker, markdown, save-to-memory
src/lib/server/               server-only modules
src/lib/server/project/       project open/init, lock, notebook db, records, exporters
src/lib/chat/                 shared validation + branch tree helpers
drizzle/                      app DB migrations
drizzle/project/              per-project notebook.db migrations
tests/                        Vitest unit tests
e2e/                          Playwright + mock OpenRouter
docs/                         architecture + task briefs + STATUS
```

## Data locations

| Item | Location |
| --- | --- |
| App data dir | `ARAITCHI_DATA_DIR` or `envPaths('araitchi').data` |
| App database | `<dataDir>/app.db` (WAL) |
| Master key | `<dataDir>/master.key` (32 random bytes) |
| Scratch project | `<dataDir>/scratch/.research/` |
| Project memory | `<projectFolder>/.research/` |

### App DB tables

- `settings` — JSON settings (`current_project_id`, default model, favourites, …)
- `secrets` — AES-256-GCM ciphertext + iv + tag
- `models_cache` — OpenRouter catalog (24h TTL)
- `projects` — recent projects (`id`, `name`, `path`, `last_opened_at`)

Chats/messages were moved out of the app DB in Task 3 (one-time migration into Scratch).

### Project layout (`.research/`)

```
.research/
  project.json     { id, name, createdAt, schemaVersion: 1, repoPath|null }
  brief.md
  notebook.db      chats, messages, records (+ FTS5)
  library/
  sessions/        YYYY-MM-DD-<slug>-<shortId>.md
  memory.md        export of records
  .gitignore       notebook.db-wal, notebook.db-shm, .lock
  .lock            PID + timestamp (read-only if held by another live process)
```

Repo detection: root `.git`, else a direct child (prefer `code/`). Araitchi never writes inside the user's repo except `.research/` at the project root.

### Notebook tables

- `chats` / `messages` — same shape as Task 2 (branched via `parent_id`)
- `records` — memory items (`hypothesis|experiment|decision|paper|question|note`) with soft delete
- `records_fts` — FTS5 over `title`/`body`, kept in sync with triggers

Exports: `memory.md` regenerates after every record change; session transcripts rewrite after each completed assistant reply.

## Chat flow

1. Client `useChat` + `AssistantChatTransport` posts to `POST /api/chat`
   with `chatId` + `modelId` (key never leaves the server).
2. Server validates (zod), scopes persistence to the **current project** notebook,
   prepends a system message from `brief.md` (~2k tokens) + pinned records (~1k),
   streams via `streamText(...).toUIMessageStreamResponse()`.
3. Usage/cost stored on the assistant message; session markdown written under `sessions/`.

## OpenRouter module

`src/lib/server/openrouter.ts` centralises base URL
(`ARAITCHI_OPENROUTER_BASE_URL` or `https://openrouter.ai/api/v1`),
attribution headers (`HTTP-Referer`, `X-Title: Araitchi`), key info, and the
AI SDK provider. OAuth PKCE:

1. `GET /api/openrouter/connect` — verifier cookie + redirect to `/auth`
2. `GET /api/openrouter/callback` — exchange code → `setSecret('openrouter_api_key')`

## Security model

1. **Localhost binding** — `127.0.0.1` only.
2. **Origin guard** — `/api/projects*`, `/api/fs*`, and other mutating routes allow only
   `http://localhost:<PORT>` / `http://127.0.0.1:<PORT>` (`PORT` = `process.env.PORT ?? 3000`),
   or missing Origin.
3. **FS list** — directories under home (`ARAITCHI_FS_ROOT` override); rejects `..` and symlink escapes via `realpath`.
4. **Encrypted secrets** — whitelist-only; never returned to the browser.
5. **Node runtime** — DB / OpenRouter / project routes use `runtime = 'nodejs'`.
