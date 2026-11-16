# Probe agreement eval (structured finalAnswer)

Models: ~anthropic/claude-haiku-latest × ~google/gemini-flash-latest
Extractor: ~google/gemini-flash-latest
Fixtures: 200 (GPQA-derived preferred)

Accuracy: **59.0%** (TPR 100.0%, FPR 100.0%)
Agree-but-wrong: **0.0%** (0/200 predicted agrees)

Decision: **DISABLE probe — route other/uncertain to council**
PROBE_ENABLED=0

| Metric | Value |
| --- | ---: |
| Accuracy | 59.0% |
| TPR | 100.0% |
| FPR | 100.0% |
| Agree-but-wrong | 0.0% |
| Exact final match rate | 100.0% |
