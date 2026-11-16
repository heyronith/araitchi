# Araitchi status

Araitchi is a local-first, self-hosted AI research workspace. You bring your own OpenRouter key; a team of models (from different labs) will help with literature review, hypotheses, and experiment design. Each research project is a folder on disk. Design doc: [product / architecture notes](https://claude.ai/artifact/9CH7PsmevH5dRzsBhx8Hng).

## Locked decisions

- **License:** MIT
- **Hosting:** local-first on `127.0.0.1` only (API keys on disk)
- **Keys:** user's own OpenRouter key (OAuth PKCE or manual)
- **Project:** folder with `.research/` memory (Task 3)
- **Always-council task types:** hypothesis generation, experiment design, literature/novelty check, critique, interpreting results
- **Classifier:** rules → LLM (`~openai/gpt-latest`, 256 tokens) → kNN fallback (LLM error / timeout >4s / offline)
- **Paper search:** multi-provider RRF + query expansion + local Qwen3 semantic rerank (default `best` stage, p50≈18.7s / p95≈19.8s on 20 LitSearch queries after warm embedder + paper-ID embed cache; hop/LLM opt-in)
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
| T9 Eval harness & v0.1 | ✅ | v0.1.0 |
| T9b Real benchmark | ✅ | v0.1.1 |
| T10 Live shakedown | ✅ | v0.1.2 |
| T11 Quality (lit / gate / scribe / probe) | ✅ | v0.1.3 — frozen LitSearch: qwen R@5 28% / R@20 41% (targets 35/55 missed; pool 94%) |
| T12 Research environment & continuity | ✅ | v0.1.4 — STATE.md, project map, recall eval, continuity tools |
| T13 Trust (citations / traceability / plan) | ✅ | v0.1.5 — citations, traceability, plan; unchecked = neither trust nor penalise |
| T11d Honest eval numbers | ✅ | v0.1.6 — LLM rerank failures visible (OpenRouter key $10 hard limit blocked live llm/recall); `best` p95≤20s; live scribe mode no silent gold fallback |

## Known issues / follow-ups

- **Owner:** run `pnpm eval:scribe` / `eval:gate` / `eval:probe` with a real OpenRouter key, update `config/defaults.json` winners (see `docs/MODEL_DEFAULTS.md`).
- **Owner:** `pnpm bench --limit 2 --repeats 1` (confirm estimate, `--yes` to skip prompt) then full `pnpm bench`; `pnpm bench:review` for rediscovery. CI runs `--dry-run` + offline fixture validation only.
- Rediscovery fixtures ship `verified: false` — excluded from headline bench tables until reviewed.
- Validation loop never executes experiment code — Cursor (or you) must write `experiments/<id>/results.json` and commit; Araitchi only reads and scores.
- **Resolved (T8b):** experiment `resultsPath` is confined to relative `experiments/<id>/*.json` and read only via repo path-safety (no absolute/`..` escapes).
- Default embedding model is Qwen3-Embedding-0.6B ONNX (~0.6 GB, downloaded once into `<dataDir>/models/`). Low-memory machines can switch to MiniLM in Settings → Memory (triggers re-index). If Qwen3 fails to load, the app falls back to EmbeddingGemma-300M, then keyword/FTS-only search.
- Scribe / gate / probe evals are manual (real key); not run in CI. Bench dry-run is in CI.
- Optional real-embedding Vitest (`ARAITCHI_REAL_EMBEDDINGS=1`) is skipped in CI. Optional live bench smoke: `ARAITCHI_LIVE_BENCH=1`.
- Web search uses OpenRouter server tools and may be region-limited; unavailable regions show a notice instead of failing the chat.
- Playwright covers onboarding skip, Evaluations fixture, solo papers + sources, council tool cards, repo open, toggles/MCP warning; PDF upload and MCP deny flows are covered in Vitest more than full UI e2e.
- Optional GitHub remote repo tools need a `github_token` secret and are minimal (log / read file).
- Chat UI uses `@ai-sdk/react` + `AssistantChatTransport` rather than a full assistant-ui Thread primitive tree.
- Cost footer relies on OpenRouter usage accounting (`usage.include`); mock e2e covers `$0.0012`.
- Next.js `cacheComponents` stays off so DB routes can use `runtime = "nodejs"`.
- pnpm 12 uses `allowBuilds` in `pnpm-workspace.yaml` (not `package.json` `onlyBuiltDependencies`).
- Folder browser FS root defaults to home; paste-a-path can open absolute dirs anywhere after confirm.
- Council presets depend on a fresh model catalog; empty/offline cache falls back poorly until refresh.
- Screenshot placeholders in README (`docs/screenshots/*.png`) are not real assets yet.

## T11d numbers (v0.1.6)

- **LitSearch frozen rank (qwen, N=100):** R@5 **28%**, R@20 **41%**, pool recall **94%**. Targets R@5≥35% / R@20≥55% **missed**.
- **LLM rerank:** prior `$0` / qwen-identical row was a soft-fail. Root cause: OpenRouter **key hard limit** ($10.01 of $10.00). Failures now counted, first error printed, run fails if fallbacks >10%. Live `rank --variant llm --limit 100` **blocked** until key limit raised (probe: 5/5 fallbacks, rate 100%).
- **Default `best` search latency (N=20, warm embedder):** before disk paper-ID cache p50 **19.0s** / p95 **20.1s**; after warm+batch16+disk cache p50 **18.7s** / p95 **19.8s**.
- **Recall `--scribe live`:** implemented (capture % vs retrieval|captured); **blocked** by same OpenRouter key limit (fails loudly, no gold fallback).

## Next steps

- Raise OpenRouter key limit (or new key); rerun `pnpm eval:litsearch:rank --variant llm --limit 100 --max-spend 2` and `pnpm eval:recall --scribe live --limit 30 --max-spend 1`.
- Owner: open a real project → indexing → ask “where are we?”; edit `.research/AGENTS.md`; confirm Read fully + model handoff + chat search.
- Capture README screenshots; tune `config/defaults.json` from eval tables.
