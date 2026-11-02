# Model defaults

`config/defaults.json` is the **single source** for shipped model and bench defaults. Application code loads it via `src/lib/server/defaults.ts` (`loadDefaults()`). Do not scatter hard-coded OpenRouter model ids elsewhere for these roles.

## What the file owns

| Key | Used for |
| --- | --- |
| `scribeModel` | Memory scribe after each reply |
| `classifierModel` | Auto-mode LLM fallback (`gate.classifierModel`) |
| `probeModels` | Auto-mode probe pair (two different labs) |
| `strongestSoloModel` | Bench config A (strongest solo baseline) |
| `council.balancedLabs` / `budgetLabs` | Lab lists for Balanced / Budget council presets |
| `council.memberCountBalanced` / `memberCountBudget` | Default member counts for those presets |
| `embeddingModel` / `embeddingModelLight` | Local Transformers.js embedders (quality vs low-memory) |
| `bench.*` | Bench budget cap, repeats, rediscovery similarity threshold |

Per-project Settings (Routing, Council, Memory) can override classifier, probe, scribe, and embedding choices. The JSON file is what new projects and fresh installs start from.

## Preference: OpenRouter latest aliases

Prefer OpenRouter **latest** aliases (for example `~openai/gpt-oss-latest`, `~anthropic/claude-haiku-latest`) so defaults track current catalog quality without editing the file on every model bump. Pin a concrete catalog id in Settings when you need a fixed mock/e2e target or a frozen eval snapshot.

## How defaults are chosen (quality first)

Run these with a real `OPENROUTER_API_KEY`. Paste tables into `evals/results/` (placeholders are committed). Then update `config/defaults.json` with the winners.

### Scribe — `pnpm eval:scribe [models…]`

Fixture transcripts in `evals/scribe/`. Scores precision, recall, duplicate rate, invented-content rate, and cost per reply.

**Pick:** best quality on precision/recall with low invented content; prefer a cheaper candidate only when quality is comparable. Default often matches the council synthesizer role.

### Classifier — `pnpm eval:gate [models…]`

Held-out labeled set in `evals/gate/`. Compare kNN only, kNN + each LLM candidate, LLM only, and the difficulty-only baseline. Metrics: accuracy, always-council recall, per-class F1, latency, cost.

**Targets:** overall accuracy ≥ 85%, always-council recall ≥ 95%.

**Pick:** most accurate LLM candidate whose **median latency ≤ 3 s**.

### Probe — `pnpm eval:probe [modelA modelB]`

Fixtures with known agree/disagree outcomes. Reports agreement-threshold ROC and a chosen threshold.

**Pick:** a two-lab pair that separates agreement well; set `gate.probeAgreementThreshold` from the eval (also mirrored in bench rediscovery similarity when appropriate). Models must be from **different labs**.

### Bench — `pnpm bench`

Compares strongest solo, always-council, adaptive Auto, and adaptive + validation under a fixed per-item budget (`bench.budgetCapUsd`, default `$0.50`). Use results to confirm adaptive routing still wins on verified progress per dollar; adjust `strongestSoloModel`, council labs, or gate defaults only when evidence says so.

Quick smoke: `pnpm bench --sets 1,2 --configs A,C --limit 5`. Full runs are manual and cost real OpenRouter spend.

## Owner workflow

1. Run `pnpm eval:scribe`, `pnpm eval:gate`, `pnpm eval:probe` (and optionally `pnpm bench`).
2. Replace placeholders under `evals/results/` with the tables/JSON.
3. Edit `config/defaults.json` (bump nothing else unless fields changed).
4. Keep `notes` in the JSON pointing at this doc.

Until evals are re-run with a live key, the committed file holds sensible latest-alias defaults — treat them as provisional.
