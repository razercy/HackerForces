"""python -m hackerforces_eval [--data ml/data/synthetic-v1.jsonl] [--report docs/evaluation.md]"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .data import load
from .evaluate import evaluate
from .report import to_json, to_markdown


def main() -> None:
    ap = argparse.ArgumentParser(description="Evaluate HackerForces integrity scoring on SYNTHETIC labelled data.")
    ap.add_argument("--data", default="ml/data/synthetic-v1.jsonl")
    ap.add_argument("--report", default="docs/evaluation.md")
    ap.add_argument("--metrics", default="ml/results/metrics.json")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--boot", type=int, default=1000)
    args = ap.parse_args()

    ds = load(args.data)
    manifest = json.loads(Path(args.data.replace(".jsonl", ".manifest.json")).read_text(encoding="utf8"))
    ev = evaluate(ds, n_splits=args.folds, seed=args.seed, n_boot=args.boot)

    Path(args.metrics).parent.mkdir(parents=True, exist_ok=True)
    Path(args.metrics).write_text(to_json(ev, manifest), encoding="utf8")
    Path(args.report).write_text(to_markdown(ev, manifest), encoding="utf8")

    r = ev["results"]
    print(f"{ev['n_scored']} scored records ({ev['n_positive']} simulated misconduct), {ev['insufficient']['count']} insufficient")
    for name, res in r.items():
        c = res.at_op
        print(f"  {name:24s} PR-AUC {res.pr_auc:.3f}  P {c.precision:.3f}  R {c.recall:.3f}  FPR {c.fpr:.3f}")
    print(f"report → {args.report}, metrics → {args.metrics}")


if __name__ == "__main__":
    main()
