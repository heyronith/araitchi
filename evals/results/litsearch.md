# LitSearch recall eval

| Stage | N | Pool recall | Recall@5 | Recall@20 | Cost/query | Latency | Avg pool | Timeouts | Fallbacks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| frozen-llm | 5* | 100.0% | 20.0% | 40.0% | $0.0000 | 20351ms | 956 | 0 | 5 |
| frozen-qwen | 2 | 100.0% | 100.0% | 100.0% | $0.0000 | 0ms | 2 | 0 | 0 |
| frozen-rrf | 100 | 94.0% | 18.0% | 35.0% | $0.0000 | 0ms | 892 | 0 | — |
| baseline | 100 | 48.0% | 13.0% | 24.0% | $0.0000 | 50823ms | 158 | — | — |
| pool (OA funded, live) | 96 | 97.9% | 22.9% | 37.5% | $0.0029 | 62642ms | 1026 | — | — |

\* `frozen-llm` N=5 probe only — OpenRouter key hard limit; 100% fallback (not a real LLM rank). Full N=100 blocked.

Ground truth: LitSearch query split; matching via normalised title overlap.

## Methodology (addendum 3)

1. **`pnpm eval:litsearch:freeze --limit 100`** — build each question's candidate pool once (all providers + OpenAlex), save under `evals/cache/litsearch-pools/`.
2. **`pnpm eval:litsearch:rank --variant rrf|qwen|llm --limit 100`** — offline ranking on frozen pools (identical candidates; OA billed once).

Freeze complete: **100/100** pools on disk (OpenAlex spend ≈ $0.78). Offline rank (T11c): qwen = llm on R@; ship `best` = expand+pool+semantic (qwen), hop/LLM opt-in. Targets R@5≥35% / R@20≥55% not met — ranking ceiling with current pools.

### Gold-provider hits (`pool` OA funded, N=96)

- openalex: 93/96 (96.9%)
- arxiv: 39/96 (40.6%)
- crossref: 31/96 (32.3%)
- openreview: 21/96 (21.9%)
- semantic_scholar: 5/96 (5.2%)
