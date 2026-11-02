# Araitchi 0.1.1

Benchmark correctness release.

## Highlights

- **Live bench** — `pnpm bench` (without `--dry-run`) runs real solo / council / Auto pipelines with OpenRouter usage costs and a per-item budget cap. Dry-run remains mock-only for CI.
- **Real fixtures** — verifiable / literature / rediscovery / validation items carry DOI or OpenAlex/URL sources (no templated “topic 0” placeholders).
- **Rediscovery review** — items ship `verified: false` and are excluded from headline metrics until `pnpm bench:review`.
- **Validation (config D)** — lock + real verdict engine; never “correct by construction”.

## Install / upgrade

```bash
git pull
pnpm install
pnpm build
pnpm start
```

## Owner checklist

1. `pnpm bench --limit 2 --repeats 1` — confirm estimate; costs should not be round mock numbers.
2. `pnpm bench:review --list` then accept/reject rediscovery ids.
3. Full `pnpm bench --yes` when ready to spend the estimated budget.
