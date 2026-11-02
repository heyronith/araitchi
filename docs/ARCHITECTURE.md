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
src/lib/server/tools/         broker, cache, rate-limit, provenance, papers/, documents/, repo/, mcp/, memory/
src/lib/server/memory/        embedder (worker), index, hybrid search, scribe, session summaries, settings
src/lib/server/gate/          Auto convene gate: rules, kNN, LLM classify, probe, merge, decisions
src/lib/gate/                 shared taxonomy (client + server)
src/lib/server/prompts/       council-*, tools-policy, scribe, evidence, merge/*
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
- `records` — memory items + FTS5 (`created_by` = `user|scribe`)
- `embeddings` — float32 vectors per owner (`record|session_summary|doc_chunk|paper`); model id stored per row; never mix models in one search
- `session_summaries` — rolling ≤300-word chat summaries
- `scribe_batches` / `scribe_suggestions` — undo snapshots + optional review queue
- `project_settings` — per-project key/value (`chat.mode`, `council.*`, `tools.*`, `scribe.*`, `memory.*`, `context.memoryTokens`)
- `tool_calls` — provenance per call (tool, args, status, cached, duration, sources)
- `tool_cache` — cached read-tool results keyed by tool + args hash
- `gate_decisions` — Auto routing log (layer, taskType, action, costs, probe agreement, corrections)
- `gate_corrections` — user overrides fed back into project kNN seeds

**Scale:** brute-force cosine in JS is fine up to ~50k chunks per project; beyond that, plan a proper ANN index.

## Convene gate (Auto mode)

Default chat mode is **Auto**. Each request is classified (rules → embedding kNN on ≥300 seeds → LLM fallback) into a task type + stakes + needsEvidence, then mapped to an action:

| Action | When |
| --- | --- |
| retrieve_evidence | factual_lookup (Papers+Web+Memory forced; `evidence.md`) |
| solo | chat / formatting / summarize / repo / code / planning |
| probe | `other` — two different-lab models; agreement via answer+claim embeddings; disagree → escalate to council reusing probe answers; agree + needsEvidence → still verify via evidence |
| council | always-council research tasks + merge-mode synthesizer prompts in `prompts/merge/` |

UI: gate chip above the reply (“Auto → Council · …”) with Why? / correct / re-run. Settings → Routing + routing log.

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
2. Server builds a **context package** once (`buildProjectSystemContext`): brief → pinned → active hypotheses → hybrid top-K for the user message (budget `context.memoryTokens`, default 6k), shared by solo and every council member
3. Streams `streamText` (tools optional, including memory tools when the Memory toggle is on)
4. After the reply finishes (does not delay tokens), the **scribe** extracts durable records asynchronously; UI shows a Memory line + optional Undo; cost logged as `scribeCost`
5. Session transcripts under `sessions/` include the rolling summary when present

## Embeddings & hybrid search

- Transformers.js + `onnxruntime-node` on the **server only**, in a `worker_threads` worker (`embedder-worker.mjs`). Default model: `onnx-community/Qwen3-Embedding-0.6B-ONNX` (q8, instruction-aware queries). Light alt: `Xenova/all-MiniLM-L6-v2`. Fallback: `onnx-community/embeddinggemma-300m-ONNX`.
- Weights download once into `<dataDir>/models/` (not git). Tests/CI use `FakeEmbedder` (`ARAITCHI_FAKE_EMBEDDINGS=1` / Vitest).
- Hybrid ranking: FTS5 BM25 + vector cosine via reciprocal-rank fusion, with small pinned/recent boosts. `read_document` prefers hybrid when chunks are indexed.
- Backfill on project open; **Rebuild memory index** in the Memory panel.

## Scribe

- Model: `scribe.model` or the council synthesizer. `scribe.enabled` (default on), `scribe.requireReview` (default off).
- Prompt: `prompts/scribe.md`. Zod-validated JSON (`create`/`update`, max 5 each) with one repair retry. Near-duplicate creates (cosine ≥ 0.90) become updates. Never deletes; hypothesis status from chat only `proposed → testing`.
- Settings + progress: `GET/PATCH /api/memory/config`; undo/accept: `POST /api/memory/scribe`.

## Tool broker

All model-callable tools go through `ToolBroker` (`src/lib/server/tools/broker.ts`), one instance per request.

- **Registry:** tools are `RegisteredTool`s (name, zod input schema, `kind` read/write/spend, provider, `ttlSec`, handler). `registerEnabledTools` registers papers / documents / repo / MCP / **memory** tools according to per-project toggles (`tools.*` in `project_settings`); `getAiSdkTools` exposes them to `streamText`. Max tool steps per reply is configurable. Memory tools (default on): `search_memory`, `get_record`, `list_hypotheses`, `list_experiments`, `search_library`.
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
