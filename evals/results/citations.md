# Citation eval

Evidence legend:

- **injected** — fixture `resolveOverride` / planted support verdict (not a live provider or model call).
- **measured** — live provider resolution and/or real scribe-model support check.

## Fixture (offline)

Cases: 290 · correct 290

Evidence: resolve=**injected**, support=**injected**.

| Metric | Value | Target |
| --- | --- | --- |
| not_found detection [injected] | 100.0% (n=60, 95% CI 94.0%–100.0%) | 100% |
| mismatch detection [injected] | 100.0% (n=40, 95% CI 91.2%–100.0%) | ≥95% |
| FP on real [injected] | 0.0% (n=150, 95% CI 0.0%–2.5%) | ≤2% |
| support accuracy (contradicted+correct) [injected] | 100.0% (n=190, 95% CI 98.0%–100.0%) | report |

By kind: fake 60/60 · mismatch 40/40 · support 40/40 · real 150/150

## Live FP on real citations (after OpenAlex reset / T11 freeze)

Evidence: resolve=**measured**, support=n/a.

| Metric | Value | Target |
| --- | --- | --- |
| FP on real [measured] | 0.0% (n=150, 95% CI 0.0%–2.5%) | ≤2% |

All 150 real citations resolved to `verified`.

## Live support (scribe model) on contradicted + real

Evidence: resolve=**measured**, support=**measured** (`~openai/gpt-latest`).

| Metric | Value | Target |
| --- | --- | --- |
| support accuracy (contradicted+correct) [measured] | 100.0% (n=190, 95% CI 98.0%–100.0%) | report |
| FP on real [measured] | 0.0% (n=150, 95% CI 0.0%–2.5%) | ≤2% |

By kind: support 40/40 (`claim_not_supported`) · real 150/150 (`verified`)
