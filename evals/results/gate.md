# Gate classifier eval

Examples: 156 (held-out). Seeds: 364.

| Method | Accuracy | Always-council recall | Median latency | Cost/call |
| --- | ---: | ---: | ---: | ---: |
| difficulty baseline | 44.2% | 31.7% | 0ms | $0.0000 |
| kNN only | 13.5% | 61.7% | 0ms | $0.0000 |
| kNN + openai/gpt-oss-20b | 4.5% | 5.0% | 150ms | $0.0000 |
| kNN + ~google/gemini-flash-latest | 8.3% | 20.0% | 2282ms | $0.0009 |
| kNN + ~anthropic/claude-haiku-latest | 12.8% | 13.3% | 307ms | $0.0001 |
| LLM only openai/gpt-oss-20b | 3.8% | 0.0% | 117ms | — |
| LLM only ~openai/gpt-oss-latest (invalid alias) | 7.7% | 0.0% | 0ms | — |

### Per-class F1 (difficulty baseline — best accuracy)

| Class | F1 |
| --- | ---: |
| chat | 50.0% |
| code_help | 95.7% |
| critique | 0.0% |
| experiment_design | 11.8% |
| factual_lookup | 56.0% |
| formatting | 95.7% |
| hypothesis_generation | 66.7% |
| literature_review | 60.9% |
| other | 21.1% |
| planning_admin | 0.0% |
| repo_status | 100.0% |
| results_interpretation | 0.0% |
| summarize_single | 0.0% |

Notes:
- `~openai/gpt-oss-latest` is **not a valid OpenRouter model id** (HTTP 400). Eval scripts now use `openai/gpt-oss-20b`.
- kNN in this harness uses the script's fake embedder (not Qwen); do not use these kNN numbers to tune production.
- Target: accuracy ≥ 85%, always-council recall ≥ 95%. **No candidate met the target** on this held-out set; difficulty baseline remains best.

