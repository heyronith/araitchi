# Evaluation data sources

This file records where external benchmark data comes from and how we use it. We do **not** commit datasets whose licences forbid redistribution; those are downloaded at eval time with a pinned URL or version.

## LitSearch (literature search recall)

- **Paper:** [LitSearch: A Retrieval Benchmark for Scientific Literature Search](https://arxiv.org/abs/2407.18940) (EMNLP 2024).
- **Dataset:** [princeton-nlp/LitSearch](https://huggingface.co/datasets/princeton-nlp/LitSearch) on Hugging Face; upstream code and data references on [GitHub (MIT)](https://github.com/princeton-nlp/LitSearch).
- **Use in Araitchi:** `pnpm eval:litsearch` downloads the query split (or a pinned subset under `evals/cache/`, gitignored) and measures recall@5 / recall@20 of ground-truth papers against our `search_papers` tool.
- **Licence:** Follow the dataset card on Hugging Face; query/relevance files are fetched at eval time rather than vendored in this repo when redistribution is unclear.

## AstaBench / PaperFindingBench / ScholarQA-CS2 (planned)

- **Source:** Ai2 AstaBench subsets for paper finding and long-form CS research Q&A.
- **Status:** Planned as optional bench sets (`--sets paperfinding,scholarqa`). Download-at-eval-time only; **licence TBD** — confirm Ai2 terms before pinning a hash in CI.

## GPQA-derived probe labels (optional)

- **Source:** GPQA-style multiple-choice science questions (e.g. GPQA-Diamond), used to build probe agreement labels from real model answers vs ground truth.
- **Status:** `scripts/build-probe-from-qa.mjs` can generate `evals/probe/gpqa-derived.json` when `OPENROUTER_API_KEY` is set. **Licence TBD** — do not commit raw GPQA items unless permitted; prefer generated labels only.

## In-repo fixtures (owned)

| Set | Path | Notes |
| --- | --- | --- |
| Gate routing | `evals/gate/` | Project taxonomy; no public benchmark |
| Scribe extraction | `evals/scribe/` | Record types specific to Araitchi |
| Probe agreement (static) | `evals/probe/fixtures.json` | Hand-written; GPQA-derived optional overlay |
| Bench mini | `evals/bench/` | Built via `pnpm bench:build-fixtures` |

## Corrections export (opt-in)

User routing corrections can be exported locally as anonymised JSONL (`GET /api/gate/corrections/export?optIn=1`): SHA-256 hash of message text plus `taskType`, derived `action`, `stakes`, and `needsEvidence`. Nothing is uploaded automatically.
