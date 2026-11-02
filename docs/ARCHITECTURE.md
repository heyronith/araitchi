# Araitchi architecture

## Stack

- **Next.js** App Router + TypeScript (`strict`) under `src/`
- **Tailwind CSS** + **shadcn/ui** (neutral, CSS variables) + **next-themes**
- **SQLite** via `better-sqlite3` + **Drizzle ORM** (two databases)
- **OpenRouter** via `@openrouter/ai-sdk-provider` + AI SDK `streamText` / `generateText`
- **Chat UI** via `@ai-sdk/react` + `@assistant-ui/react-ai-sdk` transport

## Folders

```
src/app/                      routes, layout, API handlers
src/components/ui/            shadcn primitives
src/components/shell/         app chrome (sidebar, top bar, settings, memory, council)
src/components/chat/          solo + council chat UI
src/lib/server/               server-only modules
src/lib/server/project/       project open/init, lock, notebook db, records, exporters
src/lib/server/council/       estimate, presets, anonymize, analysis, pipeline
src/lib/server/tools/         broker, cache, rate-limit, provenance, papers/, documents/, repo/, mcp/
src/lib/server/prompts/       council-member.md, council-synthesizer.md, tools-policy.md
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

### Notebook tables

- `chats` / `messages` — branched chat tree
- `records` — memory items + FTS5
- `project_settings` — per-project key/value (`chat.mode`, `council.*`, `tools.*`)
- `tool_calls` — provenance per call (tool, args, status, cached, duration, sources)
- `tool_cache` — cached read-tool results keyed by tool + args hash

## Council pipeline

`POST /api/chat` with `mode: "council"`:

1. Budget check via `estimateCouncilCost` (reject unless `allowOverBudget`)
2. Members run **in parallel** with the same project brief + pinned + history and `prompts/council-member.md` — never each other’s answers
3. Per-member timeout, one retry, optional substitute from a lab not already on the council
4. Continue if ≥ 2 members succeed; else fail with partials kept
5. Synthesizer gets **anonymized** answers (Member A/B/C, shuffled) + `prompts/council-synthesizer.md`; JSON validated with one repair retry; labels mapped back to model ids
6. Stream via `createUIMessageStream` with custom data parts:
   - `data-member` — start / delta / finish / error / substituted
   - `data-synthesis` — finalAnswer text
   - `data-analysis` — parsed disagreement object
   - `data-council-summary` — ok/failed counts, total cost, total time

Persisted as one assistant message (`modelId: "council"`) whose parts hold members, analysis, final text, and summary. Session transcripts include final answer, compact disagreement, and per-member sections.

**History for later turns:** when a follow-up message (solo or council) includes prior council replies, only each reply’s **final answer** text is sent to models — raw member answers and analysis parts are stripped (`sanitizeCouncilHistoryForModel`).

## Chat flow (solo)

1. Client posts to `POST /api/chat` with `chatId` + `modelId`
2. Server scopes to current project notebook, prepends brief + pinned, streams `streamText`
3. Usage/cost on the assistant message; session markdown under `sessions/`

## Tool broker

All model-callable tools go through `ToolBroker` (`src/lib/server/tools/broker.ts`), one instance per request.

- **Registry:** tools are `RegisteredTool`s (name, zod input schema, `kind` read/write/spend, provider, `ttlSec`, handler). `registerEnabledTools` registers papers / documents / repo / MCP tools according to per-project toggles (`tools.*` in `project_settings`); `getAiSdkTools` exposes them to `streamText`. Max tool steps per reply is configurable.
- **Cache:** read tools with `ttlSec > 0` are cached in `tool_cache` by `tool + hash(args)`.
- **Dedupe:** identical in-flight calls (same tool + args hash) share one promise.
- **Rate limit:** per-provider token buckets (`rate-limit.ts`); calls wait or abort with the request signal. Each call also has a timeout.
- **Approval:** write/spend tools (all MCP tools unless the server is marked read-only) return `needs_approval` until the client sends the matching `tool:argsHash` key in `approvals`.
- **Provenance:** every call inserts a `tool_calls` row (status, cached, duration, sources); the UI receives `BrokerToolEvent`s for tool cards and a Sources section.
- **Untrusted wrapper:** results sent to the model are truncated and wrapped as `<tool_result untrusted="true" …>`; `prompts/tools-policy.md` tells models to treat them as data, not instructions.
- **Paper providers:** OpenAlex, CORE, Semantic Scholar, arXiv, DBLP, OpenReview, Crossref (search) and Unpaywall (open-access lookup, needs `contact_email`); results are merged/deduped by DOI/arXiv id. Providers can be toggled individually; optional keys live in the encrypted secrets store.
- **Other tools:** documents (PDF/text extract, chunking), read-only repo tools (path guard, git), MCP servers (stdio or http, via `@modelcontextprotocol/sdk`; `registerMockMcpServer` for tests).
- **History:** as with council replies, only final-answer text is replayed to models on later turns; tool cards / raw tool payloads are not re-sent.
- **Config API:** `GET/PUT /api/tools/config` (toggles, max steps, `contact_email`, providers, MCP servers with header values redacted).

## Security model

1. **Localhost binding** — `127.0.0.1` only.
2. **Origin guard** — `/api/projects*`, `/api/fs*`, `/api/council*`, chat, etc.
3. **FS list** — under home (`ARAITCHI_FS_ROOT` override).
4. **Encrypted secrets** — whitelist-only.
5. **Node runtime** — DB / OpenRouter / project / council routes use `runtime = 'nodejs'`.
