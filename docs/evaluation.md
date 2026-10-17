# Evaluation on synthetic scenarios

> **All data in this report is synthetic.** It was produced by `eval/generate.ts`, which simulates editor
> behaviour and runs the production feature extractor and scorer on it. No real contestant data was used.
> These numbers describe how the pipeline behaves on the scenarios *we wrote*. They are **not** estimates of
> real-world precision, recall or false-positive rates, and must not be quoted as such.

Regenerate with `npm run eval` (TypeScript generator → Python evaluation). Deterministic for a given seed.

## Dataset

- Dataset `synthetic-v1`, seed 42, 1000 simulated contestants, 4518 contestant × problem records across 6 problems (difficulty 800–2100).
- Simulated misconduct: 331 records (7.3%). It is clustered in about 10% of contestants, which is why splits are grouped by contestant.
- Pipeline versions: features `features-v1`, scorer `baseline-v1`.
- **Insufficient data:** 126 records (2.8%) received no score (no_session: 126); 12 of them were simulated misconduct. They are excluded below, because the system refuses to score them. Every method is evaluated on the remaining 4392 records.
- Telemetry was deliberately degraded at random: about 6% of sessions lost a range of events and about 3% of submissions had no editor session.

| Scenario | Label | Records | Description |
| --- | --- | ---: | --- |
| `L_autocomplete` | legitimate | 407 | Relies on editor auto-completion for long identifiers. |
| `L_debug` | legitimate | 580 | Types the solution, runs examples, gets a wrong answer, debugs and resubmits. |
| `L_fast` | legitimate | 282 | A fast, accurate expert: quick, fairly regular typing, few errors, short time. |
| `L_library` | legitimate | 82 | Pastes a full routine from the contestant's own registered library, then adapts it by typing. |
| `L_offline_draft` | legitimate | 99 | HARD NEGATIVE: drafted offline in a local IDE and pasted whole, without registering it. Legitimate but indistinguishable from M_paste_all in editor telemetry. |
| `L_reading` | legitimate | 380 | Leaves the editor often (reading the statement, permitted tools such as CP Helper), but types everything. |
| `L_snippets` | legitimate | 110 | Pastes a couple of its own small unregistered snippets, types the rest. |
| `L_templates` | legitimate | 282 | Pastes registered templates (I/O, data structures), types the rest. |
| `L_typed` | legitimate | 1851 | Ordinary typing of the whole solution with typos and small revisions. |
| `M_humanlike` | simulated misconduct | 34 | ADVERSARIAL: copied code retyped by hand with a natural rhythm. Expected to evade editor telemetry by design. |
| `M_inject` | simulated misconduct | 30 | Code inserted by a script without any user-input annotation. |
| `M_partial` | simulated misconduct | 77 | Types boilerplate and the start of main, pastes the core algorithm. |
| `M_paste_all` | simulated misconduct | 102 | Leaves the editor, then pastes a complete solution obtained elsewhere. |
| `M_paste_edit` | simulated misconduct | 44 | Pastes a complete solution, then disguises it with small typed edits. |
| `M_robotic` | simulated misconduct | 32 | Copied code retyped by an auto-typer at a near-constant rhythm. |

## Methods

- **Baseline v1 (priors / cohort):** the production scorer exactly as it ships (`lib/integrity/baseline.ts`), at its threshold of 50. In cohort mode, the peers for each record are the other records on the same problem, which mirrors production. That cohort includes simulated misconduct, as it would in reality.
- **Isolation Forest:** scikit-learn, 300 trees, fitted on the training folds without labels. The *clean* variant is fitted on legitimate rows only. That is optimistic, because real training data is unlabelled.
- **Logistic regression:** supervised, class-balanced. It sees labels that would not exist in practice, so treat it as an upper bound on what these features can separate, not as a deployable model.
- **Validation:** 5-fold cross-validation **grouped by contestant**. No contestant appears in both training and test data, and this is asserted in code. The baselines need no training and are scored on every record.
- **Operating points:** the baselines use score ≥ 50. The learned methods flag the same number of subjects (299), giving every method the same review workload.
- **Confidence intervals:** 95% intervals from a cluster bootstrap over contestants (1000 resamples).

## Results

| Method | PR-AUC [95% CI] | Precision | Recall [95% CI] | F1 | FPR [95% CI] | Flagged / 100 | P@25 | P@50 |
| --- | --- | ---: | --- | ---: | --- | ---: | ---: | ---: |
| Baseline v1 (priors) | 0.545 [0.481, 0.604] | 67.2% | 63.0% [58.1%, 67.9%] | 0.650 | 2.4% [1.9%, 2.9%] | 6.8 | 68.0% | 34.0% |
| Baseline v1 (cohort) | 0.547 [0.485, 0.605] | 59.4% | 79.3% [75.1%, 83.1%] | 0.679 | 4.2% [3.6%, 4.9%] | 9.7 | 100.0% | 66.0% |
| Isolation Forest (unlabelled training data) | 0.599 [0.540, 0.651] | 55.2% | 51.7% [46.9%, 56.7%] | 0.534 | 3.3% [2.8%, 3.9%] | 6.8 | 100.0% | 94.0% |
| Isolation Forest (trained on legitimate only; optimistic) | 0.495 [0.430, 0.562] | 63.5% | 59.6% [54.3%, 65.0%] | 0.615 | 2.7% [2.2%, 3.2%] | 6.8 | 28.0% | 52.0% |
| Logistic regression (supervised; optimistic upper bound) | 0.873 [0.835, 0.902] | 86.0% | 80.6% [76.6%, 84.5%] | 0.832 | 1.0% [0.7%, 1.3%] | 6.8 | 100.0% | 100.0% |

Logistic regression at its natural threshold of p ≥ 0.5: precision 58.2%, recall 87.8%, FPR 4.9%.

### Flag rate per scenario

For legitimate scenarios this is the false-positive rate. For simulated misconduct it is the recall.

| Scenario | Label | Baseline v1 (priors) | Baseline v1 (cohort) | Isolation Forest (unlabelled training data) | Isolation Forest (trained on legitimate only) | Logistic regression (supervised) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `L_autocomplete` | L | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| `L_debug` | L | 0.0% | 0.0% | 2.6% | 0.0% | 0.0% |
| `L_fast` | L | 0.0% | 0.0% | 0.0% | 0.0% | 2.1% |
| `L_library` | L | 0.0% | 0.0% | 75.6% | 13.4% | 0.0% |
| `L_offline_draft` | L | 99.0% | 99.0% | 57.6% | 99.0% | 28.3% |
| `L_reading` | L | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| `L_snippets` | L | 0.0% | 68.2% | 0.0% | 0.0% | 6.4% |
| `L_templates` | L | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| `L_typed` | L | 0.0% | 0.0% | 0.0% | 0.0% | 0.1% |
| `M_humanlike` | M | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| `M_inject` | M | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| `M_partial` | M | 32.5% | 100.0% | 63.6% | 18.2% | 93.5% |
| `M_paste_all` | M | 100.0% | 100.0% | 42.2% | 100.0% | 100.0% |
| `M_paste_edit` | M | 100.0% | 100.0% | 97.7% | 100.0% | 100.0% |
| `M_robotic` | M | 0.0% | 0.0% | 0.0% | 0.0% | 28.1% |

### Baseline threshold sweep

| Threshold | Priors: precision | recall | FPR | flagged/100 | Cohort: precision | recall | FPR | flagged/100 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 58.6% | 81.2% | 4.5% | 10.1 | 52.4% | 81.5% | 5.8% | 11.3 |
| 20 | 64.6% | 79.0% | 3.4% | 8.9 | 59.3% | 79.3% | 4.3% | 9.7 |
| 30 | 71.1% | 75.5% | 2.4% | 7.7 | 59.4% | 79.3% | 4.2% | 9.7 |
| 40 | 69.2% | 69.0% | 2.4% | 7.2 | 59.4% | 79.3% | 4.2% | 9.7 |
| 50 ← | 67.2% | 63.0% | 2.4% | 6.8 | 59.4% | 79.3% | 4.2% | 9.7 |
| 60 | 65.5% | 58.3% | 2.4% | 6.5 | 59.4% | 79.3% | 4.2% | 9.7 |
| 70 | 64.0% | 54.5% | 2.4% | 6.2 | 59.4% | 79.3% | 4.2% | 9.7 |
| 80 | 59.2% | 44.5% | 2.4% | 5.5 | 69.3% | 70.2% | 2.4% | 7.4 |
| 90 | 100.0% | 3.4% | 0.0% | 0.3 | 100.0% | 7.8% | 0.0% | 0.6 |

### What the supervised model leaned on

These are the largest standardised logistic-regression coefficients, fitted on all scored records. They are descriptive only, and they partly describe the **simulator** rather than behaviour. For example, a large negative weight on `runs_before` mostly reflects that the simulated-misconduct scenarios never run the examples, which is a property of how they were written. A supervised model trained on synthetic data learns the generator's habits.

| Feature | Coefficient |
| --- | ---: |
| `runs_before` | -2.51 |
| `typed_share_of_original` | -2.28 |
| `paste_count` | -2.20 |
| `time_to_accept_min` | -2.07 |
| `pasted_chars` | -1.59 |
| `largest_unexplained_insert_share` | +1.58 |
| `adjusted_paste_share` | +1.55 |
| `typed_chars` | +1.02 |
| `typing_bursts` | +1.02 |
| `template_coverage` | -1.01 |

## Failure cases

Baseline v1 (priors), as shipped:

- **Legitimate scenarios it flags:** `L_offline_draft` 99.0%; every other legitimate scenario is at 0%.
- **Simulated misconduct it misses:** `M_humanlike` 100.0% missed, `M_robotic` 100.0% missed, `M_partial` 67.5% missed.
- **Cohort mode changes the trade-off.** On `L_snippets` its false-positive rate is 68.2%, against 0.0% in priors mode. Most peers paste little, so ordinary small pastes get large robust z-scores, and the absolute floor (half the priors start) is too lenient to stop them. It does improve recall on partial pastes. **Recommendation:** raise the cohort-mode floor to the full priors start before relying on cohort scores, and re-run this evaluation.
- **`L_offline_draft` is a designed hard negative.** Code drafted in a local IDE and pasted without being registered looks exactly like `M_paste_all` in editor telemetry, and neither the baseline nor Isolation Forest separates them. Template registration exists for this situation, and it is also why a human must review every flag.
- **`M_humanlike` is a designed miss.** Copied code retyped by hand with a natural rhythm produces telemetry identical to honest typing, and nothing browser-based can detect it. Recall on it is near zero for every method, which is the honest result.
- **`M_robotic` (auto-typed code)** is caught 0.0% of the time by the baseline: keystroke regularity (`iki_cv`) carries only 5% of its weight, so very regular typing alone cannot reach the threshold. Isolation Forest flags 0.0%, so regular timing does not stand out as unusual without labels. Only the supervised model flags some (28.1%). Detecting auto-typers would need a dedicated, validated timing signal, and a real auto-typer can add jitter anyway.
- **The supervised model partly separates `L_offline_draft` from `M_paste_all`** (it flags 28.3% of offline drafts against 99.0% for the baseline). It does so by exploiting incidental details of how the generator scripts the two scenarios, such as what is typed before or after the paste. Those are artefacts of the simulator, not behaviour we would expect to transfer. This is the main reason the supervised result is an upper bound and not evidence of a better model.

## Limitations

- **Synthetic data:** the scenarios and their mix are assumptions. Real behaviour is more varied: different editors, keyboard layouts, accessibility tools, IMEs (input method editors), and copy-paste habits we did not model. Treat the results as checks of the system's logic, not as performance estimates.
- **Class imbalance:** misconduct is rare (about 7% here; in reality the rate is unknown). Precision falls quickly as prevalence drops, so a small FPR can still mean most flags are false.
- **Distribution shift:** thresholds and weights were chosen by reasoning, and this evaluation uses the same assumptions that produced them. Results on a different contest population, problem style or editor version can differ arbitrarily.
- **Adversarial adaptation:** anyone who knows the features can avoid them by retyping, adding jitter, or emitting forged `input.type` events. Client telemetry is evidence, not proof.
- **Browser telemetry cannot observe** second devices, other people, or code typed from memory.
- **The learned methods are not deployed.** Isolation Forest scores are hard to explain to a reviewer, and the supervised model needs labelled real cases that do not exist. Baseline v1 stays the production scorer because every point it gives can be explained in a sentence.
- **Review workload:** at the shipped threshold, about 6.8 of every 100 contestant × problem subjects are flagged for review. In a real contest that is the human cost of the system and must be budgeted.

