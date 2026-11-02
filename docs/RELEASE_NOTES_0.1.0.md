# Araitchi 0.1.0

First tagged release of **Araitchi** — a local-first, self-hosted AI research workspace. Runs as a Next.js app on `127.0.0.1`; you bring your own OpenRouter key. Projects are folders on disk with `.research/` memory.

## Highlights

- **Solo & Council chat** — stream one model, or run 3–10 models in parallel with a task-aware synthesizer and disagreement analysis
- **Auto mode** — convene gate routes each message to Evidence, Solo, Probe, or Council (quality-first defaults)
- **Research tools** — papers (OpenAlex, Semantic Scholar, arXiv, DBLP, Crossref, CORE, OpenReview, Unpaywall), web, documents, read-only repo, MCP — via one approval-aware broker
- **Memory** — scribe extracts durable facts; hybrid FTS + local embeddings; shared context package
- **Validation loop** — lock predictions before runs; Cursor implements; Araitchi scores `supported` / `refuted` / `inconclusive` without executing your code
- **Eval & defaults** — `config/defaults.json`, `pnpm eval:*`, `pnpm bench`; see [MODEL_DEFAULTS.md](./MODEL_DEFAULTS.md)

## Install

```bash
./scripts/install.sh          # macOS / Linux (Node ≥ 22 + git)
# Windows: .\scripts\install.ps1
pnpm start                    # http://127.0.0.1:3000
```

Or: `corepack enable && pnpm install && pnpm build && pnpm start`.

## Docs

- [User guide](./USER_GUIDE.md)
- [Security](../SECURITY.md)
- [Changelog](../CHANGELOG.md)
- [Licence exceptions](./LICENCE_EXCEPTIONS.md)

## Notes

- Token usage and $ cost are billed to your OpenRouter account.
- Never share or commit `master.key` from the app data directory.
- Owner should run `pnpm eval:gate` / `eval:probe` / `eval:scribe` (and optionally `pnpm bench`) with a real key to refresh defaults — see known issues in [STATUS.md](./STATUS.md).

Full feature list by task: [CHANGELOG.md](../CHANGELOG.md).
