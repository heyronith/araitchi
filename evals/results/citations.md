# Citation eval

## Fixture (offline planted resolve + injected support)

Cases: 200 · correct 200

| Metric | Value | Target |
| --- | --- | --- |
| not_found detection | 100.0% (n=60, 95% CI 94.0%–100.0%) | 100% |
| mismatch detection | 100.0% (n=40, 95% CI 91.2%–100.0%) | ≥95% |
| FP on real | 0.0% (n=60, 95% CI 0.0%–6.0%) | ≤2% |
| support accuracy (contradicted+correct) | 100.0% (n=100, 95% CI 96.3%–100.0%) | report |

By kind: fake 60/60 · mismatch 40/40 · support 40/40 · real 60/60

## Keyless live (Crossref + arXiv only; fakes + mismatches)

Cases: 100 · correct 100

| Metric | Value | Target |
| --- | --- | --- |
| not_found detection | 100.0% (n=60, 95% CI 94.0%–100.0%) | 100% |
| mismatch detection | 100.0% (n=40, 95% CI 91.2%–100.0%) | ≥95% |
| support accuracy | n/a (deferred — run `--support` after OpenAlex reset / T11 freeze) | report |

## Deferred

- Model support checks on contradicted + correct subsets (`pnpm eval:citations --support`)
- OpenAlex lookups (`pnpm eval:citations --live`) after OA daily reset + T11 freeze
