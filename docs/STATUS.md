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
| T5 Tool broker & research tools | ✅ | SHA after commit |
| T6 Scribe & context | ⏳ | |
| T7 Convene gate & merge modes | ⏳ | |
| T8 Validation loop | ⏳ | |
| T9 Eval harness & v0.1 | ⏳ | |

## Known issues / follow-ups

- Auto mode remains disabled until Task 7.
- Automatic memory scribe is Task 6; memory is manual only.
- Embeddings (classifier / retrieval) land in Task 6; document `read_document` uses keyword chunk scoring for now.
- Web search uses OpenRouter server tools and may be region-limited; unavailable regions show a notice instead of failing the chat.
- Playwright covers solo papers + sources save, council tool cards, repo open, toggles/MCP warning; PDF upload and MCP deny flows are covered in Vitest (`documents`, `mcp-approval`) more than full UI e2e.
- Optional GitHub remote repo tools need a `github_token` secret and are minimal (log / read file).
- Chat UI uses `@ai-sdk/react` + `AssistantChatTransport` rather than a full assistant-ui Thread primitive tree.
- Cost footer relies on OpenRouter usage accounting (`usage.include`); mock e2e covers `$0.0012`.
- Next.js `cacheComponents` stays off so DB routes can use `runtime = "nodejs"`.
- pnpm 12 uses `allowBuilds` in `pnpm-workspace.yaml` (not `package.json` `onlyBuiltDependencies`).
- Folder browser FS root defaults to home; paste-a-path can open absolute dirs anywhere after confirm.
- Council presets depend on a fresh model catalog; empty/offline cache falls back poorly until refresh.
