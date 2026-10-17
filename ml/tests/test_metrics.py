import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from hackerforces_eval.data import Dataset, Imputer, load
from hackerforces_eval.evaluate import out_of_fold
from hackerforces_eval.metrics import average_precision, cluster_bootstrap, confusion, precision_at_k, top_k_flags


class ConfusionTests(unittest.TestCase):
    def test_hand_computed(self):
        y = np.array([1, 1, 1, 0, 0, 0, 0, 0])
        f = np.array([1, 1, 0, 1, 0, 0, 0, 0])
        c = confusion(y, f)
        self.assertEqual((c.tp, c.fp, c.tn, c.fn), (2, 1, 4, 1))
        self.assertAlmostEqual(c.precision, 2 / 3)
        self.assertAlmostEqual(c.recall, 2 / 3)
        self.assertAlmostEqual(c.f1, 2 / 3)
        self.assertAlmostEqual(c.fpr, 1 / 5)
        self.assertAlmostEqual(c.flagged_per_100, 37.5)

    def test_undefined_values_are_nan(self):
        c = confusion(np.array([0, 0]), np.array([0, 0]))
        self.assertTrue(np.isnan(c.precision))
        self.assertTrue(np.isnan(c.recall))


class RankingTests(unittest.TestCase):
    def test_average_precision_hand_computed(self):
        # Ranked: 1, 0, 1, 0 → precision at hits: 1/1, 2/3 → AP = (1 + 2/3) / 2
        y = np.array([1, 0, 1, 0])
        s = np.array([0.9, 0.8, 0.7, 0.1])
        self.assertAlmostEqual(average_precision(y, s), (1 + 2 / 3) / 2)

    def test_average_precision_ties_are_pessimistic(self):
        # All tied: negatives ranked first → precision at the single hit is 1/3.
        self.assertAlmostEqual(average_precision(np.array([0, 1, 0]), np.array([1.0, 1.0, 1.0])), 1 / 3)

    def test_perfect_ranking(self):
        self.assertEqual(average_precision(np.array([0, 1, 1]), np.array([0.1, 0.9, 0.8])), 1.0)

    def test_precision_at_k_and_top_k(self):
        y = np.array([1, 0, 1, 0, 0])
        s = np.array([5, 4, 3, 2, 1])
        self.assertEqual(precision_at_k(y, s, 2), 0.5)
        self.assertEqual(top_k_flags(s, 2).tolist(), [True, True, False, False, False])


class BootstrapTests(unittest.TestCase):
    def test_deterministic_and_bracketing(self):
        groups = np.repeat(np.arange(50), 4)
        y = (np.arange(200) % 5 == 0).astype(int)
        stat = lambda idx: float(np.mean(y[idx]))  # noqa: E731
        a = cluster_bootstrap(groups, stat, n_boot=300, seed=7)
        b = cluster_bootstrap(groups, stat, n_boot=300, seed=7)
        self.assertEqual(a, b)
        self.assertLessEqual(a[0], 0.2)
        self.assertGreaterEqual(a[1], 0.2)


def _record(i: int, contestant: str, label: int, synthetic=True) -> dict:
    rng = np.random.default_rng(i)
    feats = {"adjusted_paste_share": float(label * 0.8 + rng.random() * 0.1), "iki_cv": None if i % 3 == 0 else float(rng.random()), "typed_chars": float(rng.integers(100, 900))}
    return {
        "synthetic": synthetic,
        "id": f"r{i}",
        "contestant": contestant,
        "problem": "p",
        "difficulty": 1200,
        "scenario": "M_x" if label else "L_x",
        "label": label,
        "degraded": "none",
        "features": feats,
        "insufficient": False,
        "baselinePriors": {"score": 80.0 if label else 0.0, "band": "x"},
        "baselineCohort": {"score": 80.0 if label else 0.0, "band": "x", "cohortMode": "priors", "cohortSize": 0},
    }


class DataTests(unittest.TestCase):
    def test_refuses_untagged_data(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.jsonl"
            p.write_text(json.dumps(_record(0, "c0", 0, synthetic=False)) + "\n", encoding="utf8")
            with self.assertRaises(ValueError):
                load(p)

    def test_imputer_uses_training_medians_and_flags_missing(self):
        X = np.array([[1.0, np.nan], [3.0, 2.0], [np.nan, 4.0]])
        imp = Imputer(["typed_chars"]).fit(X)
        out = imp.transform(np.array([[np.nan, np.nan]]))
        self.assertEqual(out[0, :2].tolist(), [2.0, 3.0])

    def test_out_of_fold_never_trains_on_the_test_contestant(self):
        records = [_record(i, f"c{i // 4}", int(i % 4 == 0 and (i // 4) % 3 == 0)) for i in range(120)]
        ds = Dataset(records, list(records[0]["features"].keys()))
        oof = out_of_fold(ds, n_splits=3, seed=1)  # asserts no contestant leakage internally
        for m in ("isolation_forest", "logistic_regression"):
            self.assertFalse(np.isnan(oof[m]).any(), m)


if __name__ == "__main__":
    unittest.main()
