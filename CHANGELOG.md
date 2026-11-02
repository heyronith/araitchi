# Changelog

## 0.1.1 — 2026-11-02

### T9b — Real benchmark

- Live `pnpm bench` runs real solo/council/auto pipelines (dry-run stays mock-only)
- Real fixtures from OpenAlex/Crossref metadata (no templated placeholders)
- Rediscovery items ship `verified: false` until `pnpm bench:review`; excluded from headline metrics
- Config D uses the real lock + verdict engine (never “correct by construction”)
- `pnpm bench:validate-fixtures`, `bench:build-fixtures`, `bench:review`

## 0.1.0 — 2026-11-01

First tagged release. Local-first research workspace on Next.js + OpenRouter.
Note: the v0.1.0 bench harness only exercised dry-run mocks; live scoring arrived in 0.1.1.

### T1 — Scaffold

- Next.js App Router, TypeScript strict, Tailwind + shadcn/ui, pnpm, Node 22
- SQLite app DB (Drizzle), OS app-data paths, localhost-only `dev`/`start`
- MIT licence, CI lint/typecheck/test/build baseline

### T2 — OpenRouter + solo chat

- OAuth PKCE or manual API key; encrypted secrets store
- Model catalog, favourites, streaming solo chat, usage/$ cost footer

### T3 — Project workspace & memory

- Project = folder with `.research/` (brief, notebook DB, sessions, memory export)
- Scratch default project; recent projects; folder browser

### T4 — Council engine

- Parallel 3–10 member council + synthesizer, disagreement analysis
- Budget estimate/cap, Balanced/Budget presets, anonymized merge

### T5 — Tool broker & research tools

- Shared broker: papers (multi-provider + Unpaywall), web, documents, read-only repo, MCP, cache/rate-limit/approvals/provenance
- Untrusted tool-result wrapping

### T5b — Chat UX polish

- Thinking/phase status, streamed reasoning collapse, open (bubble-free) replies

### T6 — Scribe & context

- Async scribe → notebook records; hybrid FTS + embedding search; context package
- Local Transformers.js embedders; memory tools; `pnpm eval:scribe`

### T7 — Convene gate & merge modes

- Auto mode: rules → kNN → LLM → Evidence / Solo / Probe / Council
- Task-specific council merge prompts; routing UI + log; `eval:gate` / `eval:probe`

### T8 — Validation loop

- Preregistered experiments, prediction lock, Cursor instructions, deterministic verdicts
- Timeline + “Already tested” context; app never executes experiment code
- T8b: confine `resultsPath` to relative `experiments/<id>/*.json`

### T9 — Eval harness & v0.1

- `config/defaults.json` single source for model/bench defaults; docs for defaults, user guide, security, licences
- Benchmark harness (`pnpm bench`), install scripts, onboarding, Evaluations settings page (as shipped in this release)
- Version **0.1.0**
