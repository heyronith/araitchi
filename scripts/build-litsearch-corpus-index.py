#!/usr/bin/env python3
"""Fill evals/cache/litsearch-corpus-index.json from LitSearch HF corpus_clean parquet.

Reads needed corpusids from litsearch-queries.json (first --limit rows) and any
IDs passed as extra CLI args. Prefer this over Semantic Scholar when the S2 key
is missing/invalid.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

try:
    import pyarrow.parquet as pq
except ImportError:
    print("pyarrow required: pip install pyarrow", file=sys.stderr)
    sys.exit(2)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument(
        "--ids",
        nargs="*",
        type=int,
        default=[],
        help="Extra corpusids to resolve",
    )
    args = ap.parse_args()
    root = Path(args.root)
    cache_dir = root / "evals" / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    q_path = cache_dir / "litsearch-queries.json"
    out_path = cache_dir / "litsearch-corpus-index.json"

    needed: set[int] = set(args.ids)
    if q_path.exists():
        qs = json.loads(q_path.read_text())[: args.limit]
        for q in qs:
            for i in q.get("corpusids") or []:
                needed.add(int(i))

    found: dict[int, str] = {}
    if out_path.exists():
        for k, v in json.loads(out_path.read_text()).items():
            if v and str(v).strip():
                found[int(k)] = str(v).strip()

    missing = needed - set(found)
    if not missing:
        print(f"[corpus] already complete {len(found)} titles", file=sys.stderr)
        return 0

    print(
        f"[corpus] resolving {len(missing)} titles via HF LitSearch parquet…",
        file=sys.stderr,
    )
    base = "https://huggingface.co/api/datasets/princeton-nlp/LitSearch/parquet/corpus_clean/full"
    tmp = Path("/tmp")
    for i in range(6):
        if not missing:
            break
        url = f"{base}/{i}.parquet"
        dest = tmp / f"litsearch-corpus-{i}.parquet"
        if not dest.exists() or dest.stat().st_size < 1000:
            print(f"[corpus] download {url}", file=sys.stderr)
            urllib.request.urlretrieve(url, dest)
        table = pq.read_table(dest, columns=["corpusid", "title"])
        cids = table.column("corpusid").to_pylist()
        titles = table.column("title").to_pylist()
        for cid, title in zip(cids, titles):
            if cid in missing and title:
                found[int(cid)] = str(title).strip()
                missing.discard(int(cid))
        print(
            f"[corpus] parquet {i}: have {len(needed) - len(missing)}/{len(needed)}",
            file=sys.stderr,
        )

    out_path.write_text(
        json.dumps({str(k): v for k, v in sorted(found.items())}, indent=2) + "\n"
    )
    still = needed - set(found)
    print(
        f"[corpus] wrote {out_path} size={len(found)} stillMissing={len(still)}",
        file=sys.stderr,
    )
    return 1 if still else 0


if __name__ == "__main__":
    raise SystemExit(main())
