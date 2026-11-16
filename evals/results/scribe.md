# Scribe eval

Fixtures: 40. Models: ~openai/gpt-latest, ~google/gemini-flash-latest, ~anthropic/claude-sonnet-latest.

Filters: evidence quote ∈ source + claim entailed by quote (production path).

| Model | Precision | Recall | Dup rate | Invented (b) | Cost/reply | (a) overstate | (b) gold-gap | (c) ungrounded |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ~openai/gpt-latest | 98% | 80% | 0% | 3% | $0.0018 | 3 | 1 | 1 |
| ~google/gemini-flash-latest | 100% | 82% | 0% | 0% | $0.0019 | 4 | 0 | 0 |
| ~anthropic/claude-sonnet-latest | 100% | 60% | 0% | 0% | $0.0033 | 16 | 0 | 0 |

Invented categories (counts over all fixtures):
- **(a)** quote verified but claim failed entailment → dropped before score
- **(b)** grounded+entailed but not in gold (real invent / labeling gap)
- **(c)** quote not in source → dropped (eval bug if these were scored as invent)
