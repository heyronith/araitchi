# Araitchi status

Araitchi is a local-first, self-hosted AI research workspace. You bring your own OpenRouter key; a team of models (from different labs) will help with literature review, hypotheses, and experiment design. Each research project is a folder on disk. Design doc: [product / architecture notes](https://claude.ai/artifact/9CH7PsmevH5dRzsBhx8Hng).

## Locked decisions

- **License:** MIT
- **Hosting:** local-first on `127.0.0.1` only (API keys on disk)
- **Keys:** user's own OpenRouter key (OAuth PKCE or manual)
- **Project:** folder with `.research/` memory (Task 3)
- **Always-council task types:** hypothesis generation, experiment design, literature/novelty check, critique, interpreting results
- **Classifier:** rules → bundled embedding model (Transformers.js) → `gpt-oss-20b` via OpenRouter (no Ollama)
- **Paper sources:** OpenAlex, CORE, Semantic Scholar, arXiv, DBLP, OpenReview, Crossref, Unpaywall

## Task table

| Task | Status | Notes |
| --- | --- | --- |
| T1 Scaffold | ✅ | `cc3026e` |
| T2 OpenRouter + solo chat | ✅ | `bbcd690` |
| T3 Project workspace & memory | ✅ | `1c4067c` |
| T4 Council engine | ✅ | `34b03ae` |
| T5 Tool broker & research tools | ✅ | `de170ec` |
| T5b Chat UX polish | ✅ | `d4ff206` |
| T6 Scribe & context | ✅ | `da535da` |
| T7 Convene gate & merge modes | ✅ | `a6092e6` |
| T8 Validation loop | ✅ | `abf5407` |
| T9 Eval harness & v0.1 | ⏳ | |

## Known issues / follow-ups

- Auto mode is the default. Owner should run `pnpm eval:gate` / `pnpm eval:probe` with a real OpenRouter key and paste tables into `evals/results/` (placeholders committed).
- Validation loop never executes experiment code — Cursor (or you) must write `experiments/<id>/results.json` and commit; Araitchi only reads and scores.
- **Resolved (T8b):** experiment `resultsPath` is confined to relative `experiments/<id>/*.json` and read only via repo path-safety (no absolute/`..` escapes).
- Default embedding model is Qwen3-Embedding-0.6B ONNX (~0.6 GB, downloaded once into `<dataDir>/models/`). Low-memory machines can switch to MiniLM in Settings → Memory (triggers re-index). If Qwen3 fails to load, the app falls back to EmbeddingGemma-300M, then keyword/FTS-only search.
- Scribe quality eval (`pnpm eval:scribe`) is manual and needs a real OpenRouter key; not run in CI.
- Optional real-embedding Vitest (`ARAITCHI_REAL_EMBEDDINGS=1`) is skipped in CI.
- Web search uses OpenRouter server tools and may be region-limited; unavailable regions show a notice instead of failing the chat.
- Playwright covers solo papers + sources save, council tool cards, repo open, toggles/MCP warning; PDF upload and MCP deny flows are covered in Vitest (`documents`, `mcp-approval`) more than full UI e2e.
- Optional GitHub remote repo tools need a `github_token` secret and are minimal (log / read file).
- Chat UI uses `@ai-sdk/react` + `AssistantChatTransport` rather than a full assistant-ui Thread primitive tree.
- Cost footer relies on OpenRouter usage accounting (`usage.include`); mock e2e covers `$0.0012`.
- Next.js `cacheComponents` stays off so DB routes can use `runtime = "nodejs"`.
- pnpm 12 uses `allowBuilds` in `pnpm-workspace.yaml` (not `package.json` `onlyBuiltDependencies`).
- Folder browser FS root defaults to home; paste-a-path can open absolute dirs anywhere after confirm.
- Council presets depend on a fresh model catalog; empty/offline cache falls back poorly until refresh.
