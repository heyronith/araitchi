#!/usr/bin/env bash
# Wait for OpenAlex daily budget, then freeze LitSearch pools and rank offline.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "[waiter] started $(date -u)"

for i in $(seq 1 120); do
  status="$(node -e '
const k=process.env.OPENALEX_API_KEY||"";
fetch("https://api.openalex.org/works?per_page=1&api_key="+encodeURIComponent(k))
  .then(async r=>{
    process.stdout.write(JSON.stringify({
      status:r.status,
      rem:r.headers.get("x-ratelimit-remaining-usd"),
      reset:r.headers.get("x-ratelimit-reset"),
    }));
  })
  .catch(e=>process.stdout.write(JSON.stringify({err:String(e)})));
')"
  echo "[waiter] $(date -u) $status"
  rem="$(node -e 'try{const j=JSON.parse(process.argv[1]);process.stdout.write(String(j.rem??""))}catch{}' "$status")"
  if node -e 'const n=Number(process.argv[1]); process.exit(Number.isFinite(n)&&n>0.05?0:1)' "$rem"; then
    echo "[waiter] budget ok — freezing pools"
    pnpm eval:litsearch:freeze --limit 100 --timeout-ms 120000
    echo "FREEZE_EXIT:$?"
    for v in rrf qwen llm; do
      echo "[waiter] rank $v"
      pnpm eval:litsearch:rank --variant "$v" --limit 100
      echo "RANK_${v}:$?"
    done
    echo DONE
    exit 0
  fi
  sleep 300
done
echo "[waiter] timed out waiting for OA budget"
exit 1
