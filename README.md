# Araitchi

Araitchi is a local-first, self-hosted AI research workspace. It runs as a Next.js app on your machine; you bring your own OpenRouter API key. A team of models from different labs will help with literature review, hypotheses, and experiment design — each research project is a folder on disk.

**Status:** v0.1.1

![Chat — Auto mode](docs/screenshots/chat-auto.png)
![Council reply](docs/screenshots/council.png)
![Memory & timeline](docs/screenshots/memory-timeline.png)
![Validation loop](docs/screenshots/validation-loop.png)

> Screenshot assets are placeholders until captured for the release.

## Requirements

- Node.js 22 LTS (see `.nvmrc`)
- [pnpm](https://pnpm.io) via Corepack (`corepack enable`)
- `git` on PATH (repo tools + install scripts)

## Quick start

```bash
./scripts/install.sh   # macOS/Linux — or: .\scripts\install.ps1 on Windows
pnpm start             # http://127.0.0.1:3000
```

Manual equivalent:

```bash
corepack enable && pnpm install && pnpm build && pnpm start
```

`dev` and `start` bind to **127.0.0.1 only** (not `0.0.0.0`) because the app stores API keys on disk.

### Connect OpenRouter

1. Open **Settings → Keys**.
2. Prefer **Connect with OpenRouter** (OAuth PKCE), or paste an API key manually and Save.
3. Pick a model in the composer (catalog refreshes from OpenRouter; favourites + default live in Settings → Models).
4. Chat. **Token usage and $ cost are billed to your OpenRouter account.**

### Projects

A **project** is any folder on disk. Opening one creates `<folder>/.research/` (idempotent):

| Path | Purpose |
| --- | --- |
| `project.json` | id, name, schemaVersion, optional `repoPath` |
| `brief.md` | Goal / constraints / definitions (editable in the Memory panel) |
| `notebook.db` | Per-project SQLite (chats, messages, memory records) |
| `memory.md` | Readable export of records (regenerated on change) |
| `sessions/` | Markdown transcripts of chat branches |
| `library/` | Papers / documents |
| `experiments/` | Validation-loop Cursor instructions + metadata |

You may **commit `.research/` to git** or add it to `.gitignore` — your choice. Araitchi never writes into your repo except for that `.research/` directory at the project root.

A default **Scratch** project lives under the app data dir so chatting never requires choosing a folder first.

### Auto / Solo / Council

**Auto** is the default. Each message is classified (rules → local embedding kNN → optional LLM) and routed to the cheapest trustworthy action: **Evidence**, **Solo**, **Probe** (two labs; escalate on disagreement), or **Council**. A chip above the reply shows the decision; open **Why?** to see the layer/confidence/reason, correct the task type, or re-run as Solo/Council. Slash overrides: `/solo`, `/council`, `/probe`, `/evidence`.

Configure thresholds and models under **Settings → Routing** (routing log included). Eval locally (needs your OpenRouter key):

```bash
pnpm eval:gate [models…]
pnpm eval:probe [modelA modelB]
```

Model defaults live in `config/defaults.json` — see [docs/MODEL_DEFAULTS.md](docs/MODEL_DEFAULTS.md).

### Validation loop

Hypotheses become **preregistered experiments**: design → edit predictions → **Lock predictions** (SHA-256 lock; immutable). Araitchi writes Cursor instructions under `.research/experiments/<id>/` telling the agent to implement under `experiments/<id>/`, write `results.json` matching the contract (`experimentId`, `lockHash`, seeded `runs[].metrics`), and commit `exp(<id>): …` — **the app never runs your code**. **Check results** scores predictions deterministically (`supported` / `refuted` / `inconclusive`); an interpretation note may raise concerns but cannot flip the verdict. Override only with a written reason. Memory → **Timeline** shows the arc; related chats get an **Already tested** context section so refuted ideas are not re-proposed blindly.

**Council** (forced or from Auto) still sends your message to **3–10 models in parallel**, then a synthesizer merges with a **task-specific** prompt (literature union, distinct hypotheses, experiment protocols, critique severity, evidence-grounded results).

- Configure members, synthesizer, token limit, timeout, and **budget cap** under **Settings → Council**.
- Presets **Balanced** / **Budget** come from the live OpenRouter catalog.
- Composer shows a live cost estimate; confirm **Run anyway** if over cap.

### Tools (research tools)

Open **Settings → Tools** to choose what models may use. Toggles are per project:

| Toggle | What it does |
| --- | --- |
| Papers | Search OpenAlex, Semantic Scholar, arXiv, DBLP, Crossref, CORE, OpenReview; resolve open-access PDFs via Unpaywall |
| Web | OpenRouter server-side web search (may be region-limited) |
| Documents | Read PDFs / text you add to the project library |
| Repo | Read-only git/repo tools (needs the `git` binary on PATH; refuses `.env` and similar) |
| MCP | Tools from MCP servers you add |
| Memory | Search notebook / hypotheses / library (default on) |

- **Optional keys** (Settings → Keys): OpenAlex, CORE, Semantic Scholar, and a GitHub token (read-only). Paper search works without them, with lower rate limits.
- **Contact email** (`contact_email`): sent to Crossref / OpenAlex polite pools and required for Unpaywall. It is not a secret.
- **Providers:** each paper provider can be switched off individually.
- **MCP servers:** add a name plus a stdio command or an http URL. **Stdio MCP servers run commands on this computer — only add servers you trust.** MCP tools are approval-gated unless you mark the server read-only.
- Tool output is treated as untrusted data, never as instructions.

Manual paper-API smoke (hits real services, no LLM, not CI):

```bash
pnpm smoke:papers "graph neural networks for molecules"
```

### Memory & scribe

After each assistant reply, a **scribe** model extracts durable research facts (hypotheses, experiments, decisions, papers, questions, notes) into the project notebook. You’ll see a compact **Memory:** line under the reply (with Undo). Settings → **Memory**:

- Turn the scribe **off**, require Accept/Dismiss review, or pick a cheaper scribe model (default = council synthesizer).
- Choose the local embedding model. The quality default (~0.6 GB ONNX) downloads once into the app data `models/` folder with a progress notice, then works offline. MiniLM is available for low-memory machines (switching re-indexes).
- If the embedding download fails, search falls back to keyword (FTS) only.

The composer shows a **Context** indicator (brief · pinned · relevant). Models receive a shared context package and can call memory tools when the Memory toggle is on.

```bash
pnpm eval:scribe   # manual quality table vs OpenRouter (not CI)
```

### Manual smoke (not CI)

```bash
OPENROUTER_API_KEY=sk-or-... pnpm smoke:openrouter
```

Lists models, sends a tiny prompt to a cheap model, prints reply + cost.

## Docs

| Doc | Contents |
| --- | --- |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Everyday use: projects, modes, council, tools, memory, validation, costs, privacy |
| [SECURITY.md](SECURITY.md) | Threat model and how to report issues |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack and internals |
| [docs/MODEL_DEFAULTS.md](docs/MODEL_DEFAULTS.md) | How `config/defaults.json` is chosen |
| [docs/LICENCE_EXCEPTIONS.md](docs/LICENCE_EXCEPTIONS.md) | Runtime licence policy / exceptions |
| [docs/STATUS.md](docs/STATUS.md) | Task progress and known issues |

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Next.js dev server on `127.0.0.1:3000` |
| `pnpm build` / `pnpm start` | Production build / server (localhost only) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript (`tsc --noEmit`) |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Playwright (Chromium) + mock OpenRouter |
| `pnpm check:secrets` | Fail if client bundle leaks `sk-or-` |
| `pnpm check:secrets:selftest` | Asserts the leak checker detects a planted string |
| `pnpm smoke:openrouter` | Live OpenRouter smoke (manual) |
| `pnpm smoke:papers "<query>"` | Live paper-provider smoke (manual) |
| `pnpm eval:scribe` / `eval:gate` / `eval:probe` | Manual quality evals (need OpenRouter key) |
| `pnpm bench` | Adaptive vs solo/council benchmark (manual, costly) |
| `pnpm db:generate` / `pnpm db:migrate` | App DB Drizzle migrations |
| `pnpm db:generate:project` | Project notebook migrations |

## Where data is stored

**App data** lives in an OS-correct directory (override with `ARAITCHI_DATA_DIR`):

| OS | Default path |
| --- | --- |
| macOS | `~/Library/Application Support/araitchi` |
| Windows | `%APPDATA%\araitchi` |
| Linux | `~/.local/share/araitchi` |

Contents include `app.db` (settings, secrets, recent projects), `master.key`, and `scratch/` (default project).

**Project memory** lives in each project's `.research/` folder (see above).

## Security notes

- Server listens on localhost only so API keys are not exposed on the LAN.
- Secrets are encrypted with AES-256-GCM; the master key is `master.key` with mode `0600` where the OS supports it.
- **Never share or commit `master.key`.** Anyone with that file and `app.db` can decrypt your keys.
- Mutating API routes (and `/api/projects*`, `/api/fs*`) reject non-local `Origin` headers (exact app port only).
- Folder browser (`/api/fs/list`) is restricted to your home directory (override with `ARAITCHI_FS_ROOT` in tests). Paste-a-path can open absolute directories anywhere after confirmation.
- Secret values are never returned to the browser — only boolean “set / not set” status.
- Optional: point tests at a mock with `ARAITCHI_OPENROUTER_BASE_URL`.
- Full threat model: [SECURITY.md](SECURITY.md).

## Reset

Delete the data directory (see table above, or your `ARAITCHI_DATA_DIR`). The next launch recreates an empty database and a new master key. Project folders on disk are left untouched unless you delete them yourself.

## License

MIT — Copyright (c) 2026 heyronith
