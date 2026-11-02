# Araitchi user guide

Local-first AI research workspace. Runs on your machine; you bring an OpenRouter key. Each project is a folder on disk.

## Start

1. Install and run (see [README](../README.md) quick start).
2. Open [http://127.0.0.1:3000](http://127.0.0.1:3000).
3. **Settings → Keys** — Connect with OpenRouter (OAuth PKCE) or paste a key.
4. Open or create a **project** folder (or use the default Scratch project).
5. Chat. Usage and $ cost bill to your OpenRouter account.

## Projects

A project is any folder. Opening one creates `<folder>/.research/` (idempotent): brief, notebook DB, memory export, session transcripts, library, experiments.

- Edit **brief.md** (goal / constraints) in the Memory panel.
- Commit `.research/` or gitignore it — your choice.
- Araitchi does **not** write into your repo except `.research/` at the project root (and Cursor may write experiment code under `experiments/<id>/` when you ask it to).

## Modes: Auto / Solo / Council

| Mode | Behaviour |
| --- | --- |
| **Auto** (default) | Classifies each message (rules → local embedding kNN → optional LLM) and routes to Evidence, Solo, Probe, or Council. Chip above the reply shows the decision; **Why?** for details, corrections, or re-run. |
| **Solo** | One model you pick in the composer. |
| **Council** | 3–10 models in parallel, then a synthesizer merge. |

Slash overrides: `/solo`, `/council`, `/probe`, `/evidence`.

**Always-council** task types (unless you change them under Settings → Routing): hypothesis generation, experiment design, literature/novelty check, critique, interpreting results.

**Probe:** two models from different labs; on disagreement Auto escalates to council (reusing probe answers).

Configure thresholds and models under **Settings → Routing**.

## Council

- Members answer independently (never see each other); synthesizer gets anonymized answers.
- Merge prompt is **task-specific** (literature union, distinct hypotheses, experiment protocols, critique severity, evidence-grounded results).
- **Settings → Council:** members, synthesizer, token limit, timeout, budget cap. Presets **Balanced** / **Budget** from the live catalog.
- Composer shows a live cost estimate; confirm **Run anyway** if over cap.

## Tools

**Settings → Tools** (per project):

| Toggle | Role |
| --- | --- |
| Papers | OpenAlex, Semantic Scholar, arXiv, DBLP, Crossref, CORE, OpenReview; Unpaywall for OA PDFs |
| Web | OpenRouter server-side web search (region-limited) |
| Documents | PDFs / text in the project library |
| Repo | Read-only git/repo tools (`git` on PATH; refuses secrets like `.env`) |
| MCP | Tools from servers you add (stdio runs local commands — trust only) |
| Memory | Search notebook / hypotheses / library (default on) |

Optional keys (OpenAlex, CORE, Semantic Scholar, GitHub) and `contact_email` live under Settings → Keys. Paper search works without optional keys at lower rate limits.

Write/spend and most MCP tools need **approval** in the UI unless the MCP server is marked read-only. Tool output is untrusted data, not instructions.

## Memory & scribe

After each assistant reply, a **scribe** model extracts durable facts (hypotheses, experiments, decisions, papers, questions, notes). Compact **Memory:** line under the reply includes Undo.

**Settings → Memory:** enable/disable scribe, require Accept/Dismiss review, scribe model, embedding model (quality ~0.6 GB ONNX download once, or MiniLM for low memory).

Composer **Context** indicator: brief · pinned · relevant. Models get a shared context package.

## Validation loop

Hypotheses become **preregistered experiments**:

1. Design → edit predictions → **Lock predictions** (SHA-256; immutable).
2. Araitchi writes Cursor instructions under `.research/experiments/<id>/`.
3. You (or Cursor) implement under `experiments/<id>/`, write `results.json`, commit — **the app never runs experiment code**.
4. **Check results** → deterministic `supported` / `refuted` / `inconclusive`. Interpretation notes cannot flip the verdict. Override only with a written reason.

Memory → **Timeline** shows the arc. Related chats get an **Already tested** section so refuted ideas are not re-proposed blindly.

## Costs

- All LLM / web-tool usage is billed by OpenRouter (`usage.include` drives the cost footer).
- Council has a budget cap; Auto/Solo still consume tokens for the chosen model(s), scribe, and optional classifier.
- Optional paper API keys are separate provider accounts/limits.

## Privacy

- Server binds **127.0.0.1 only**.
- Secrets encrypted at rest (AES-256-GCM); master key in the app data dir — never share or commit `master.key`.
- Project memory stays in your folder; no Araitchi cloud.
- See [SECURITY.md](../SECURITY.md) for the threat model and reporting.
