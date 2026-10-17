"""Method comparison with contestant-grouped cross-validation."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .data import Dataset, Imputer
from .metrics import Confusion, average_precision, cluster_bootstrap, confusion, precision_at_k, top_k_flags

BASELINE_THRESHOLD = 50.0
METHODS = ("baseline_priors", "baseline_cohort", "isolation_forest", "isolation_forest_clean", "logistic_regression")
METHOD_LABELS = {
    "baseline_priors": "Baseline v1 (priors)",
    "baseline_cohort": "Baseline v1 (cohort)",
    "isolation_forest": "Isolation Forest (unlabelled training data)",
    "isolation_forest_clean": "Isolation Forest (trained on legitimate only; optimistic)",
    "logistic_regression": "Logistic regression (supervised; optimistic upper bound)",
}


@dataclass
class MethodResult:
    name: str
    scores: np.ndarray
    flags: np.ndarray
    operating_point: str
    pr_auc: float
    pr_auc_ci: tuple[float, float]
    at_op: Confusion
    recall_ci: tuple[float, float]
    fpr_ci: tuple[float, float]
    precision_at: dict[int, float]
    per_scenario: dict[str, float] = field(default_factory=dict)


def out_of_fold(ds: Dataset, n_splits: int = 5, seed: int = 0) -> dict[str, np.ndarray]:
    """Scores for every record from models that never saw that contestant."""
    X = ds.raw_matrix()
    y = ds.labels
    groups = ds.groups
    n = len(y)
    oof = {m: np.full(n, np.nan) for m in ("isolation_forest", "isolation_forest_clean", "logistic_regression")}
    for fold, (train, test) in enumerate(GroupKFold(n_splits=n_splits, shuffle=True, random_state=seed).split(X, y, groups)):
        # Leakage guard: no contestant on both sides.
        assert not set(groups[train]) & set(groups[test]), "contestant leakage between folds"
        imp = Imputer(ds.feature_names).fit(X[train])
        Xtr, Xte = imp.transform(X[train]), imp.transform(X[test])

        iso = IsolationForest(n_estimators=300, contamination="auto", random_state=seed + fold).fit(Xtr)
        oof["isolation_forest"][test] = -iso.score_samples(Xte)
        iso_clean = IsolationForest(n_estimators=300, contamination="auto", random_state=seed + fold).fit(Xtr[y[train] == 0])
        oof["isolation_forest_clean"][test] = -iso_clean.score_samples(Xte)

        lr = make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=5000, C=1.0))
        lr.fit(Xtr, y[train])
        oof["logistic_regression"][test] = lr.predict_proba(Xte)[:, 1]
    oof["baseline_priors"] = np.array([r["baselinePriors"]["score"] for r in ds.records], dtype=float)
    oof["baseline_cohort"] = np.array([r["baselineCohort"]["score"] for r in ds.records], dtype=float)
    return oof


def evaluate(ds: Dataset, n_splits: int = 5, seed: int = 0, n_boot: int = 1000) -> dict:
    """Evaluates every method on records that have enough data to be scored."""
    scored_mask = np.array([not r["insufficient"] for r in ds.records])
    insufficient = ds.subset(~scored_mask)
    ds = ds.subset(scored_mask)
    y, groups, scen = ds.labels, ds.groups, ds.scenarios
    oof = out_of_fold(ds, n_splits=n_splits, seed=seed)

    # Fair comparison: learned methods flag as many subjects as the production baseline (same review budget).
    budget = int(np.sum(oof["baseline_priors"] >= BASELINE_THRESHOLD))
    results: dict[str, MethodResult] = {}
    for m in METHODS:
        s = oof[m]
        if m.startswith("baseline"):
            flags, op = s >= BASELINE_THRESHOLD, f"score ≥ {BASELINE_THRESHOLD:g}"
        else:
            flags, op = top_k_flags(s, budget), f"top {budget} (baseline-priors review budget)"
        c = confusion(y, flags)
        results[m] = MethodResult(
            name=m,
            scores=s,
            flags=flags,
            operating_point=op,
            pr_auc=average_precision(y, s),
            pr_auc_ci=cluster_bootstrap(groups, lambda idx: average_precision(y[idx], s[idx]), n_boot=n_boot, seed=seed),
            at_op=c,
            recall_ci=cluster_bootstrap(groups, lambda idx: confusion(y[idx], flags[idx]).recall, n_boot=n_boot, seed=seed + 1),
            fpr_ci=cluster_bootstrap(groups, lambda idx: confusion(y[idx], flags[idx]).fpr, n_boot=n_boot, seed=seed + 2),
            precision_at={k: precision_at_k(y, s, k) for k in (25, 50, 100)},
            per_scenario={sc: float(np.mean(flags[scen == sc])) for sc in sorted(set(scen))},
        )
    # Logistic regression at its natural 0.5 threshold, for reference.
    lr_half = confusion(y, oof["logistic_regression"] >= 0.5)

    sweep = {}
    for m in ("baseline_priors", "baseline_cohort"):
        rows = []
        for t in range(10, 100, 10):
            c = confusion(y, oof[m] >= t)
            rows.append({"threshold": t, "precision": c.precision, "recall": c.recall, "fpr": c.fpr, "flagged_per_100": c.flagged_per_100})
        sweep[m] = rows

    # Interpretable view of what the supervised model leaned on (fit on all scored data; descriptive only).
    X = ds.raw_matrix()
    imp = Imputer(ds.feature_names).fit(X)
    lr = make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=5000)).fit(imp.transform(X), y)
    coefs = sorted(zip(imp.output_names, lr[-1].coef_[0]), key=lambda kv: -abs(kv[1]))[:10]

    return {
        "n_records": len(ds.records) + len(insufficient.records),
        "n_scored": len(ds.records),
        "n_positive": int(y.sum()),
        "n_contestants": len(set(groups)),
        "insufficient": {
            "count": len(insufficient.records),
            "positives": int(insufficient.labels.sum()) if insufficient.records else 0,
            "by_degradation": _count(r["degraded"] for r in insufficient.records),
        },
        "budget": budget,
        "results": results,
        "lr_half": lr_half,
        "sweep": sweep,
        "lr_coefficients": coefs,
        "scenario_labels": {sc: int(y[scen == sc][0]) for sc in sorted(set(scen))},
        "scenario_counts": {sc: int(np.sum(scen == sc)) for sc in sorted(set(scen))},
        "n_splits": n_splits,
        "n_boot": n_boot,
        "seed": seed,
    }


def _count(xs) -> dict[str, int]:
    out: dict[str, int] = {}
    for x in xs:
        out[x] = out.get(x, 0) + 1
    return out
