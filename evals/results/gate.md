# Gate classifier eval

Examples: 326 (held-out). Seeds: 364. Embedder: `onnx-community/Qwen3-Embedding-0.6B-ONNX`.

| Method | Task acc | Action acc | Always-council recall | Median latency | Cost/call | Parse fail |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| difficulty baseline | 40.5% | 45.1% | 41.3% | 0ms | $0.0000 | — |
| kNN only (production embedder) | 27.3% | 50.9% | 88.9% | 32ms | $0.0000 | — |
| kNN + ~openai/gpt-latest | 84.4% | 89.3% | 96.8% | 2922ms | $0.0010 | 0.0% |
| kNN + ~google/gemini-flash-latest | 78.8% | 85.0% | 95.2% | 2665ms | $0.0009 | 0.0% |
| kNN + ~anthropic/claude-haiku-latest | 81.0% | 86.5% | 96.8% | 1028ms | $0.0001 | 0.0% |
| kNN + openai/gpt-oss-20b | 73.6% | 79.8% | 92.9% | 2075ms | $0.0000 | 0.0% |
| LLM only ~openai/gpt-latest | 92.0% | 94.2% | 96.8% | 3046ms | $0.0009 | 2.8% |

### Per-class F1 (best action-accuracy row)

Best: **LLM only ~openai/gpt-latest**

| Class | F1 |
| --- | ---: |
| chat | 93.9% |
| code_help | 91.3% |
| critique | 94.1% |
| experiment_design | 96.2% |
| factual_lookup | 96.0% |
| formatting | 87.3% |
| hypothesis_generation | 100.0% |
| literature_review | 98.1% |
| other | 70.2% |
| planning_admin | 96.0% |
| repo_status | 98.0% |
| results_interpretation | 93.9% |
| summarize_single | 83.7% |

Target: **action-level accuracy ≥ 85%**, always-council recall ≥ 95%.
Debug log: `evals/results/gate-debug.jsonl`.

