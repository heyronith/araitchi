# Gate classifier eval

_Placeholder — owner should run `pnpm eval:gate` with `OPENROUTER_API_KEY` and replace this file._

| Method | Accuracy | Always-council recall | Median latency | Cost/call |
| --- | ---: | ---: | ---: | ---: |
| difficulty baseline | (run locally) | | | |
| kNN only | (run locally) | | | |
| kNN + ~openai/gpt-oss-latest | (run locally) | | | |

Target: accuracy ≥ 85%, always-council recall ≥ 95%. Default `gate.classifierModel` ships as `~openai/gpt-oss-latest` (quality-first latest alias; change after eval).
