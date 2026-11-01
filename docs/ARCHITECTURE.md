# Araitchi architecture

## Stack

- **Next.js** App Router + TypeScript (`strict`) under `src/`
- **Tailwind CSS** + **shadcn/ui** (neutral, CSS variables) + **next-themes**
- **SQLite** via `better-sqlite3` + **Drizzle ORM**
- **OpenRouter** via `@openrouter/ai-sdk-provider` + AI SDK `streamText`
- **Chat UI** via `@ai-sdk/react` + `@assistant-ui/react-ai-sdk` transport

## Folders

```
src/app/                 routes, layout, API handlers
src/components/ui/       shadcn primitives
src/components/shell/    app chrome (sidebar, top bar, settings)
src/components/chat/     solo chat panel, model picker, markdown
src/lib/server/          server-only modules (DB, secrets, OpenRouter, chats)
src/lib/chat/            shared validation + branch tree helpers
drizzle/                 SQL migrations
tests/                   Vitest unit tests
e2e/                     Playwright + mock OpenRouter
docs/                    architecture + task briefs + STATUS
```

## Data locations

| Item | Location |
| --- | --- |
| App data dir | `ARAITCHI_DATA_DIR` or `envPaths('araitchi').data` |
| Database | `<dataDir>/app.db` (WAL) |
| Master key | `<dataDir>/master.key` (32 random bytes) |

### Tables

- `settings` — JSON settings (default model, favourites, …)
- `secrets` — AES-256-GCM ciphertext + iv + tag
- `models_cache` — OpenRouter catalog (24h TTL)
- `chats` / `messages` — solo chat tree (`parent_id` for branches)

## OpenRouter module

`src/lib/server/openrouter.ts` centralises base URL
(`ARAITCHI_OPENROUTER_BASE_URL` or `https://openrouter.ai/api/v1`),
attribution headers (`HTTP-Referer`, `X-Title: Araitchi`), key info, and the
AI SDK provider. OAuth PKCE:

1. `GET /api/openrouter/connect` — verifier cookie + redirect to `/auth`
2. `GET /api/openrouter/callback` — exchange code → `setSecret('openrouter_api_key')`

## Chat flow

1. Client `useChat` + `AssistantChatTransport` posts to `POST /api/chat`
   with `chatId` + `modelId` (key never leaves the server).
2. Server validates (zod), persists user/assistant rows, streams via
   `streamText(...).toUIMessageStreamResponse()`.
3. Usage/cost stored on the assistant message; sidebar lists chats from DB.

## Security model

1. **Localhost binding** — `127.0.0.1` only.
2. **Origin guard** — mutating routes allow only
   `http://localhost:<PORT>` / `http://127.0.0.1:<PORT>` (`PORT` = `process.env.PORT ?? 3000`),
   or missing Origin.
3. **Encrypted secrets** — whitelist-only; never returned to the browser.
4. **Node runtime** — DB / OpenRouter routes use `runtime = 'nodejs'`.
