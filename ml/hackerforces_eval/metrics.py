"""Metrics, implemented with numpy only so they can be checked by hand."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Confusion:
    tp: int
    fp: int
    tn: int
    fn: int

    @property
    def precision(self) -> float:
        return self.tp / (self.tp + self.fp) if self.tp + self.fp else float("nan")

    @property
    def recall(self) -> float:
        return self.tp / (self.tp + self.fn) if self.tp + self.fn else float("nan")

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if p + r and not (np.isnan(p) or np.isnan(r)) else float("nan")

    @property
    def fpr(self) -> float:
        return self.fp / (self.fp + self.tn) if self.fp + self.tn else float("nan")

    @property
    def flagged_per_100(self) -> float:
        n = self.tp + self.fp + self.tn + self.fn
        return 100 * (self.tp + self.fp) / n if n else float("nan")


def confusion(y: np.ndarray, flagged: np.ndarray) -> Confusion:
    y = np.asarray(y).astype(bool)
    f = np.asarray(flagged).astype(bool)
    return Confusion(tp=int(np.sum(f & y)), fp=int(np.sum(f & ~y)), tn=int(np.sum(~f & ~y)), fn=int(np.sum(~f & y)))


def average_precision(y: np.ndarray, scores: np.ndarray) -> float:
    """PR-AUC as average precision: mean of precision at each true positive, ties broken pessimistically."""
    y = np.asarray(y).astype(int)
    s = np.asarray(scores, dtype=float)
    if y.sum() == 0:
        return float("nan")
    # Sort by score desc; among ties put negatives first (pessimistic, deterministic).
    order = np.lexsort((y, -s))
    y_sorted = y[order]
    hits = np.cumsum(y_sorted)
    precision_at = hits / np.arange(1, len(y_sorted) + 1)
    return float(np.sum(precision_at[y_sorted == 1]) / y.sum())


def precision_at_k(y: np.ndarray, scores: np.ndarray, k: int) -> float:
    k = min(k, len(y))
    if k == 0:
        return float("nan")
    order = np.lexsort((np.asarray(y), -np.asarray(scores, dtype=float)))
    return float(np.mean(np.asarray(y)[order][:k]))


def top_k_flags(scores: np.ndarray, k: int) -> np.ndarray:
    """Flags exactly the k highest scores (deterministic tie-break by index)."""
    order = np.argsort(-np.asarray(scores, dtype=float), kind="stable")
    flags = np.zeros(len(scores), dtype=bool)
    flags[order[:k]] = True
    return flags


def cluster_bootstrap(groups: np.ndarray, statistic, n_boot: int = 1000, seed: int = 0, alpha: float = 0.05):
    """Percentile CI resampling whole contestants (clusters) with replacement.

    `statistic(idx)` receives row indices of a bootstrap sample and returns a float.
    """
    rng = np.random.default_rng(seed)
    uniq, inverse = np.unique(groups, return_inverse=True)
    rows_by_group = [np.flatnonzero(inverse == g) for g in range(len(uniq))]
    values = []
    for _ in range(n_boot):
        chosen = rng.integers(0, len(uniq), size=len(uniq))
        idx = np.concatenate([rows_by_group[g] for g in chosen])
        v = statistic(idx)
        if not np.isnan(v):
            values.append(v)
    if not values:
        return (float("nan"), float("nan"))
    lo, hi = np.quantile(values, [alpha / 2, 1 - alpha / 2])
    return (float(lo), float(hi))
