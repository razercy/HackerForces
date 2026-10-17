"""Loading the synthetic dataset and building feature matrices."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# Features whose absence is meaningful get an explicit missing indicator.
MISSING_INDICATORS = ("iki_median_ms", "iki_cv", "time_to_accept_min")


@dataclass(frozen=True)
class Dataset:
    records: list[dict]
    feature_names: list[str]

    @property
    def labels(self) -> np.ndarray:
        return np.array([r["label"] for r in self.records], dtype=int)

    @property
    def groups(self) -> np.ndarray:
        return np.array([r["contestant"] for r in self.records])

    @property
    def scenarios(self) -> np.ndarray:
        return np.array([r["scenario"] for r in self.records])

    def raw_matrix(self) -> np.ndarray:
        """Features (NaN where unavailable) plus problem difficulty."""
        rows = [[np.nan if r["features"][n] is None else float(r["features"][n]) for n in self.feature_names] + [float(r["difficulty"])] for r in self.records]
        return np.array(rows, dtype=float)

    def subset(self, mask: np.ndarray) -> "Dataset":
        return Dataset([r for r, keep in zip(self.records, mask) if keep], self.feature_names)


def load(path: str | Path) -> Dataset:
    records = [json.loads(line) for line in Path(path).read_text(encoding="utf8").splitlines() if line.strip()]
    if not records:
        raise ValueError(f"{path} is empty")
    for r in records:
        # Refuse anything that is not explicitly synthetic: this tooling must never be pointed at real people.
        if r.get("synthetic") is not True:
            raise ValueError(f"record {r.get('id')} is not tagged synthetic; refusing to evaluate")
    names = list(records[0]["features"].keys())
    return Dataset(records, names)


class Imputer:
    """Median imputation fitted on training rows, plus missing indicators."""

    def __init__(self, feature_names: list[str]):
        self.columns = feature_names + ["difficulty"]
        self.indicator_idx = [self.columns.index(n) for n in MISSING_INDICATORS if n in self.columns]
        self.medians: np.ndarray | None = None

    def fit(self, X: np.ndarray) -> "Imputer":
        med = np.nanmedian(X, axis=0)
        self.medians = np.where(np.isnan(med), 0.0, med)
        return self

    def transform(self, X: np.ndarray) -> np.ndarray:
        assert self.medians is not None, "fit first"
        filled = np.where(np.isnan(X), self.medians, X)
        indicators = np.isnan(X[:, self.indicator_idx]).astype(float)
        return np.hstack([filled, indicators])

    @property
    def output_names(self) -> list[str]:
        return self.columns + [f"{self.columns[i]}_missing" for i in self.indicator_idx]
