# Probe agreement eval

Models: ~anthropic/claude-haiku-latest × ~google/gemini-flash-latest
Fixtures: 240

Chosen threshold: **0.42** (accuracy 65.8%, TPR 86.2%, FPR 61.8%)

| Threshold | Acc | TPR | FPR |
| ---: | ---: | ---: | ---: |
| 0.42 | 66% | 86% | 62% |
| 0.44 | 65% | 83% | 58% |
| 0.64 | 53% | 30% | 17% |
| 0.68 | 53% | 30% | 17% |
| 0.72 | 53% | 30% | 17% |
| 0.76 | 53% | 30% | 17% |
| 0.8 | 53% | 30% | 17% |
| 0.84 | 53% | 30% | 17% |
| 0.88 | 53% | 30% | 17% |
| 0.92 | 53% | 30% | 17% |
| 0.56 | 52% | 30% | 19% |
| 0.6 | 52% | 30% | 19% |

### Agree-but-wrong (from GPQA-derived build labels)

On 200 template science MCQ items labeled by the probe pair against ground truth: **0%** of agreements were both-wrong (agree_right=118, disagree=82, agree_but_wrong=0). Easy templates make shared wrong rare; harden the set (real GPQA-Diamond when redistributable / licensed) before trusting this rate.

**Shipped threshold remains 0.48** (provisional). The auto-chosen 0.42 above uses a fake embedder in `eval:probe` and is not production-ready; re-tune with the production Qwen embedder after OpenRouter credits are available.
