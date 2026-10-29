"""Markdown report and JSON metrics for an evaluation run."""

from __future__ import annotations

import json
import math

from .evaluate import BASELINE_THRESHOLD, METHOD_LABELS, METHODS


def _f(x: float, digits: int = 3) -> str:
    return "–" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x:.{digits}f}"


def _pct(x: float) -> str:
    return "–" if x is None or math.isnan(x) else f"{100 * x:.1f}%"


def _ci(ci: tuple[float, float], pct: bool = False) -> str:
    lo, hi = ci
    return f"[{_pct(lo)}, {_pct(hi)}]" if pct else f"[{_f(lo)}, {_f(hi)}]"


def to_json(ev: dict, manifest: dict) -> str:
    res = {
        m: {
            "operating_point": r.operating_point,
            "pr_auc": r.pr_auc,
            "pr_auc_ci": r.pr_auc_ci,
            "precision": r.at_op.precision,
            "recall": r.at_op.recall,
            "recall_ci": r.recall_ci,
            "f1": r.at_op.f1,
            "fpr": r.at_op.fpr,
            "fpr_ci": r.fpr_ci,
            "flagged_per_100": r.at_op.flagged_per_100,
            "confusion": vars(r.at_op),
            "precision_at": r.precision_at,
            "per_scenario_flag_rate": r.per_scenario,
        }
        for m, r in ev["results"].items()
    }
    out = {
        "synthetic": True,
        "note": "SYNTHETIC DATA. Not real-world accuracy.",
        "dataset": manifest,
        "summary": {k: ev[k] for k in ("n_records", "n_scored", "n_positive", "n_contestants", "insufficient", "budget", "n_splits", "n_boot", "seed")},
        "methods": res,
        "baseline_threshold_sweep": ev["sweep"],
        "logistic_regression_at_0_5": vars(ev["lr_half"]),
        "logistic_regression_top_coefficients": [[n, float(c)] for n, c in ev["lr_coefficients"]],
    }
    return json.dumps(out, indent=2, default=float)


def to_markdown(ev: dict, manifest: dict) -> str:
    R = ev["results"]
    labels = ev["scenario_labels"]
    counts = ev["scenario_counts"]
    legit = [s for s in labels if labels[s] == 0]
    mis = [s for s in labels if labels[s] == 1]
    bp = R["baseline_priors"]
    ruleset = manifest["rulesetVersion"]
    L: list[str] = []
    w = L.append

    w("# Evaluation on synthetic scenarios")
    w("")
    w("> **All data in this report is synthetic.** It was produced by `eval/generate.ts`, which simulates editor")
    w("> behaviour and runs the production feature extractor and scorer on it. No real contestant data was used.")
    w("> These numbers describe how the pipeline behaves on the scenarios *we wrote*. They are **not** estimates of")
    w("> real-world precision, recall or false-positive rates, and must not be quoted as such.")
    w("")
    w("Regenerate with `npm run eval` (TypeScript generator → Python evaluation). Deterministic for a given seed.")
    w("")
    w("## Dataset")
    w("")
    w(f"- Dataset `{manifest['dataset']}`, seed {manifest['seed']}, {manifest['contestants']} simulated contestants, "
      f"{ev['n_records']} contestant × problem records across {len(manifest['problems'])} problems (difficulty "
      f"{min(p['difficulty'] for p in manifest['problems'])}–{max(p['difficulty'] for p in manifest['problems'])}).")
    w(f"- Simulated misconduct: {sum(counts[s] for s in mis) + ev['insufficient']['positives']} records "
      f"({100 * (sum(counts[s] for s in mis) + ev['insufficient']['positives']) / ev['n_records']:.1f}%). It is clustered in about 10% of contestants, "
      "which is why splits are grouped by contestant.")
    w(f"- Pipeline versions: features `{manifest['featureSetVersion']}`, scorer `{manifest['rulesetVersion']}`.")
    ins = ev["insufficient"]
    w(f"- **Insufficient data:** {ins['count']} records ({100 * ins['count'] / ev['n_records']:.1f}%) received no score "
      f"({', '.join(f'{k}: {v}' for k, v in sorted(ins['by_degradation'].items()))}); {ins['positives']} of them were simulated misconduct. "
      "They are excluded below, because the system refuses to score them. Every method is evaluated on the "
      f"remaining {ev['n_scored']} records.")
    w("- Telemetry was deliberately degraded at random: about 6% of sessions lost a range of events and about 3% of "
      "submissions had no editor session.")
    w("")
    w("| Scenario | Label | Records | Description |")
    w("| --- | --- | ---: | --- |")
    from_desc = manifest.get("scenarioDescriptions", {})
    for s in legit + mis:
        w(f"| `{s}` | {'simulated misconduct' if labels[s] else 'legitimate'} | {counts[s]} | {from_desc.get(s, '')} |")
    w("")
    w("## Methods")
    w("")
    w(f"- **Baseline (priors / cohort):** the production scorer `{ruleset}` exactly as it ships (`lib/integrity/baseline.ts`), at "
      f"its threshold of {BASELINE_THRESHOLD:g}. In cohort mode, the peers for each record are the other records on the "
      "same problem, which mirrors production. That cohort includes simulated misconduct, as it would in reality.")
    w("- **Isolation Forest:** scikit-learn, 300 trees, fitted on the training folds without labels. The *clean* variant "
      "is fitted on legitimate rows only. That is optimistic, because real training data is unlabelled.")
    w("- **Logistic regression:** supervised, class-balanced. It sees labels that would not exist in practice, so treat "
      "it as an upper bound on what these features can separate, not as a deployable model.")
    w(f"- **Validation:** {ev['n_splits']}-fold cross-validation **grouped by contestant**. No contestant appears in both "
      "training and test data, and this is asserted in code. The baselines need no training and are scored on every record.")
    w(f"- **Operating points:** the baselines use score ≥ {BASELINE_THRESHOLD:g}. The learned methods flag the same number "
      f"of subjects ({ev['budget']}), giving every method the same review workload.")
    w(f"- **Confidence intervals:** 95% intervals from a cluster bootstrap over contestants ({ev['n_boot']} resamples).")
    w("")
    w("## Results")
    w("")
    w("| Method | PR-AUC [95% CI] | Precision | Recall [95% CI] | F1 | FPR [95% CI] | Flagged / 100 | P@25 | P@50 |")
    w("| --- | --- | ---: | --- | ---: | --- | ---: | ---: | ---: |")
    for m in METHODS:
        r = R[m]
        c = r.at_op
        w(f"| {METHOD_LABELS[m]} | {_f(r.pr_auc)} {_ci(r.pr_auc_ci)} | {_pct(c.precision)} | {_pct(c.recall)} {_ci(r.recall_ci, True)} | "
          f"{_f(c.f1)} | {_pct(c.fpr)} {_ci(r.fpr_ci, True)} | {_f(c.flagged_per_100, 1)} | {_pct(r.precision_at[25])} | {_pct(r.precision_at[50])} |")
    lh = ev["lr_half"]
    w("")
    w(f"Logistic regression at its natural threshold of p ≥ 0.5: precision {_pct(lh.precision)}, recall {_pct(lh.recall)}, FPR {_pct(lh.fpr)}.")
    w("")
    w("### Flag rate per scenario")
    w("")
    w("For legitimate scenarios this is the false-positive rate. For simulated misconduct it is the recall.")
    w("")
    w("| Scenario | Label | " + " | ".join(METHOD_LABELS[m].split(" (")[0] + (" (" + METHOD_LABELS[m].split(" (")[1].split(";")[0].rstrip(")") + ")" if " (" in METHOD_LABELS[m] else "") for m in METHODS) + " |")
    w("| --- | --- | " + " | ".join("---:" for _ in METHODS) + " |")
    for s in legit + mis:
        w(f"| `{s}` | {'M' if labels[s] else 'L'} | " + " | ".join(_pct(R[m].per_scenario[s]) for m in METHODS) + " |")
    w("")
    w("### Baseline threshold sweep")
    w("")
    w("| Threshold | Priors: precision | recall | FPR | flagged/100 | Cohort: precision | recall | FPR | flagged/100 |")
    w("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
    for a, b in zip(ev["sweep"]["baseline_priors"], ev["sweep"]["baseline_cohort"]):
        mark = " ←" if a["threshold"] == BASELINE_THRESHOLD else ""
        w(f"| {a['threshold']}{mark} | {_pct(a['precision'])} | {_pct(a['recall'])} | {_pct(a['fpr'])} | {_f(a['flagged_per_100'], 1)} | "
          f"{_pct(b['precision'])} | {_pct(b['recall'])} | {_pct(b['fpr'])} | {_f(b['flagged_per_100'], 1)} |")
    w("")
    w("### What the supervised model leaned on")
    w("")
    w("These are the largest standardised logistic-regression coefficients, fitted on all scored records. They are descriptive only, "
      "and they partly describe the **simulator** rather than behaviour. For example, a large negative weight on `runs_before` mostly "
      "reflects that the simulated-misconduct scenarios never run the examples, which is a property of how they were written. A "
      "supervised model trained on synthetic data learns the generator's habits.")
    w("")
    w("| Feature | Coefficient |")
    w("| --- | ---: |")
    for name, coef in ev["lr_coefficients"]:
        w(f"| `{name}` | {coef:+.2f} |")
    w("")

    # ---- failure analysis, driven by the numbers
    w("## Failure cases")
    w("")
    fp_by = sorted(((s, bp.per_scenario[s]) for s in legit), key=lambda kv: -kv[1])
    fn_by = sorted(((s, 1 - bp.per_scenario[s]) for s in mis), key=lambda kv: -kv[1])
    w(f"Baseline `{ruleset}` (priors), as shipped:")
    w("")
    flagged_legit = [(s, v) for s, v in fp_by if v > 0]
    missed = [(s, v) for s, v in fn_by if v > 0]
    w("- **Legitimate scenarios it flags:** " + (", ".join(f"`{s}` {_pct(v)}" for s, v in flagged_legit) or "none") + "; every other legitimate scenario is at 0%.")
    w("- **Simulated misconduct it misses:** " + (", ".join(f"`{s}` {_pct(v)} missed" for s, v in missed) or "none") + ".")
    bc = R["baseline_cohort"]
    worst_cohort = max(legit, key=lambda s: bc.per_scenario[s] - bp.per_scenario[s])
    best_cohort = max(mis, key=lambda s: bc.per_scenario[s] - bp.per_scenario[s])
    gain = (f"It raises recall on `{best_cohort}` from {_pct(bp.per_scenario[best_cohort])} to {_pct(bc.per_scenario[best_cohort])}"
            if bc.per_scenario[best_cohort] > bp.per_scenario[best_cohort] else "It does not raise recall on any misconduct scenario")
    if bc.per_scenario[worst_cohort] > bp.per_scenario[worst_cohort]:
        w(f"- **Cohort mode changes the trade-off.** On `{worst_cohort}` its false-positive rate is {_pct(bc.per_scenario[worst_cohort])}, "
          f"against {_pct(bp.per_scenario[worst_cohort])} in priors mode: when most peers paste little, ordinary pastes get large robust z-scores "
          f"that the absolute floor does not stop. {gain}. Weigh both before relying on cohort scores.")
    else:
        w(f"- **Cohort mode adds sensitivity without adding false positives here.** No legitimate scenario is flagged more often than in "
          f"priors mode (overall FPR {_pct(bc.at_op.fpr)} against {_pct(bp.at_op.fpr)}). {gain}, because a value above the priors start that is "
          "extreme relative to peers counts for more than the priors ramp gives it. The absolute floor is closed up to the priors start, so a small paste in a cohort that "
          "pastes even less is not flagged. `baseline-v1` opened that floor at half the priors start and flagged most `L_snippets` records "
          "in cohort mode; this evaluation is what led to raising it. These cohorts are synthetic; real cohorts may be smaller or more varied.")
    w("- **`L_offline_draft` is a designed hard negative.** Code drafted in a local IDE and pasted without being registered "
      "looks exactly like `M_paste_all` in editor telemetry, and neither the baseline nor Isolation Forest separates them. Template registration exists for "
      "this situation, and it is also why a human must review every flag.")
    w("- **`M_humanlike` is a designed miss.** Copied code retyped by hand with a natural rhythm produces telemetry identical to "
      "honest typing, and nothing browser-based can detect it. Recall on it is near zero for every method, which is the honest result.")
    rob = {m: R[m].per_scenario["M_robotic"] for m in METHODS}
    w(f"- **`M_robotic` (auto-typed code)** is caught {_pct(rob['baseline_priors'])} of the time by the baseline: keystroke regularity "
      f"(`iki_cv`) carries only 5% of its weight, so very regular typing alone cannot reach the threshold. Isolation Forest flags "
      f"{_pct(rob['isolation_forest'])}, so regular timing does not stand out as unusual without labels. Only the supervised model "
      f"flags some ({_pct(rob['logistic_regression'])}). Detecting auto-typers would need a dedicated, validated timing signal, and a real "
      "auto-typer can add jitter anyway.")
    off = {m: R[m].per_scenario["L_offline_draft"] for m in METHODS}
    w(f"- **The supervised model partly separates `L_offline_draft` from `M_paste_all`** (it flags {_pct(off['logistic_regression'])} of offline drafts "
      f"against {_pct(off['baseline_priors'])} for the baseline). It does so by exploiting incidental details of how the generator scripts the two "
      "scenarios, such as what is typed before or after the paste. Those are artefacts of the simulator, not behaviour we would expect "
      "to transfer. This is the main reason the supervised result is an upper bound and not evidence of a better model.")
    w("")
    w("## Limitations")
    w("")
    w("- **Synthetic data:** the scenarios and their mix are assumptions. Real behaviour is more varied: different editors, keyboard "
      "layouts, accessibility tools, IMEs (input method editors), and copy-paste habits we did not model. Treat the results as checks "
      "of the system's logic, not as performance estimates.")
    w("- **Class imbalance:** misconduct is rare (about 7% here; in reality the rate is unknown). Precision falls quickly as prevalence "
      "drops, so a small FPR can still mean most flags are false.")
    w("- **Distribution shift:** thresholds and weights were chosen by reasoning, and this evaluation uses the same assumptions that "
      "produced them. Results on a different contest population, problem style or editor version can differ arbitrarily.")
    w("- **Adversarial adaptation:** anyone who knows the features can avoid them by retyping, adding jitter, or emitting forged "
      "`input.type` events. Client telemetry is evidence, not proof.")
    w("- **Browser telemetry cannot observe** second devices, other people, or code typed from memory.")
    w("- **The learned methods are not deployed.** Isolation Forest scores are hard to explain to a reviewer, and the supervised model "
      "needs labelled real cases that do not exist. The transparent baseline stays the production scorer because every point it gives can be "
      "explained in a sentence.")
    w("- **Review workload:** at the shipped threshold, about " + _f(bp.at_op.flagged_per_100, 1) + " of every 100 contestant × problem "
      "subjects are flagged for review. In a real contest that is the human cost of the system and must be budgeted.")
    w("")
    return "\n".join(L) + "\n"
