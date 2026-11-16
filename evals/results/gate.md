# Gate classifier eval

Examples: 326 (held-out). Seeds: 364. Embedder: `onnx-community/Qwen3-Embedding-0.6B-ONNX`.

| Method | Task acc | Action acc | Always-council recall | Median latency | Cost/call | Parse fail |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| difficulty baseline | 40.5% | 45.1% | 41.3% | 0ms | $0.0000 | — |
| kNN only (production embedder) | 27.3% | 50.9% | 88.9% | 35ms | $0.0000 | — |
| kNN + ~openai/gpt-latest | 83.7% | 88.7% | 96.8% | 3206ms | $0.0010 | 0.0% |
| kNN + ~google/gemini-flash-latest | 75.5% | 81.0% | 88.9% | 2432ms | $0.0007 | 13.9% |
| kNN + ~anthropic/claude-haiku-latest | 80.1% | 84.4% | 90.5% | 1002ms | $0.0001 | 7.2% |
| kNN + ~anthropic/claude-sonnet-latest | 80.4% | 86.2% | 93.7% | 1116ms | $0.0015 | 1.6% |
| kNN + openai/gpt-oss-20b | 70.9% | 78.5% | 85.7% | 943ms | $0.0000 | 4.8% |
| LLM-first ~openai/gpt-latest (production) | 92.0% | 94.5% | 99.2% | 3388ms | $0.0010 | 0.0% |

### Per-class F1 (best action-accuracy row)

Best: **LLM-first ~openai/gpt-latest (production)**

| Class | F1 |
| --- | ---: |
| chat | 89.8% |
| code_help | 89.4% |
| critique | 94.1% |
| experiment_design | 96.2% |
| factual_lookup | 92.3% |
| formatting | 87.3% |
| hypothesis_generation | 98.0% |
| literature_review | 94.5% |
| other | 80.9% |
| planning_admin | 98.0% |
| repo_status | 98.0% |
| results_interpretation | 92.6% |
| summarize_single | 83.7% |

Target: **action-level accuracy ≥ 85%**, always-council recall ≥ 95%.
Debug log: `evals/results/gate-debug.jsonl`.

