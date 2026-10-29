# Integrity analysis

> An anomaly score is a prompt for human review. It is not evidence of
> misconduct, and nothing in the system penalises a contestant automatically.

## Pipeline

```
telemetry_event / code_snapshot / submission   (raw, Phase 3)
        │  loadAnalysisInput — deterministic ordering
        ▼
extractFeatures  (lib/integrity/features.ts, pure, "features-v1")
        │  → feature_vector   (unique by inputs digest: same inputs ⇒ same row)
        ▼
scoreAssessment  (lib/integrity/baseline.ts, pure, "baseline-v2")
        │  → anomaly_assessment  (append-only history; skipped if identical)
        ▼
review queue / detail  (reviewer-only; dashboard in Phase 5)
```

- **Subject.** One subject is a (contestant, contest, problem). The assessed
  submission is the first accepted one, or the latest judged one if none was
  accepted. Only telemetry from before that submission counts. In the
  submission's own editor session the cut-off is exact (the seq of its submit
  marker); elsewhere it falls back to time.
- **Triggers.** Every judged submission enqueues its subject in the same
  transaction that records the verdict. Jobs live in a durable `analysis_job`
  queue (lease, fencing, retries, dead-letter), one row per subject, so bursts of
  triggers collapse. A trigger that arrives while a job runs causes exactly one
  re-run. `/api/cron/analysis` re-scores recently ended contests against their
  complete cohort, and `npm run analyze -- <slug>` does the same on demand.
- **Reproducibility.** `inputs_digest` is the SHA-256 of the canonical JSON of
  every input: events, submissions, templates, contest window and difficulty.
  `reference_digest` hashes the cohort statistics that were used. Re-running
  with nothing changed is a no-op.

## Templates and approved snippets

- **Personal templates** (`/templates`). Each template is a series of
  append-only, server-timestamped versions with a SHA-256. For a given contest,
  the version that applies is the latest one saved **before the contest
  started**. A template archived before the start does not apply. Saving or
  archiving during a contest affects only later contests.
- **Approved snippets** are added or retired by the contest's managers, and are
  in effect from creation until retirement.
- **The editor starter code** is always approved.
- **Matching** (`lib/integrity/similarity.ts`). The code is stripped of comments
  and tokenized. A submission token counts as covered if it lies inside a
  6-token window that also appears in some template. Formatting and comments
  don't matter. *Limitation:* renaming identifiers defeats matching, and so does
  heavily rewriting a template, which then counts as original code.
- Covered characters are subtracted before any paste-related feature is measured.

## Features (`features-v1`)

| Feature | Meaning |
| --- | --- |
| `adjusted_paste_share` | Pasted, dropped and unattributed characters, minus template-covered code, divided by final length |
| `largest_unexplained_insert_share` | Largest single non-typed insertion, minus covered code, divided by final length |
| `max_growth_10s_share` | Largest growth of the document within 10 s, minus covered code, divided by final length |
| `typed_share_of_original` | Typed characters divided by the non-template part of the final code |
| `unattributed_insert_share` | Insertions with no user-event annotation (not typed, pasted or dropped) |
| `iki_median_ms`, `iki_cv` | Keystroke timing during bursts. Needs at least 30 intervals; otherwise *unavailable* |
| `typing_bursts`, `revision_ratio`, `undo_count` | How the code was written and rewritten |
| `runs_before`, `rejected_before`, `compile_errors_before`, `time_to_accept_min` | Workflow leading up to the assessed submission |
| `blur_before_large_insert` | Large insertion within 60 s of leaving the editor. **Context only, weight 0**: permitted tools (e.g. CP Helper) and reading the statement cause it too |

**Data quality.** Coverage is the minimum of three things: sequence completeness,
whether the pre-submit snapshot matches the submitted code, and how well the
reconstructed document length matches. A submission with no linked editor
session, no recorded edits, or purged telemetry gets coverage 0. With coverage
below 0.5 the result is **"Insufficient data"** and no score. Missing data is
never treated as a signal.

## Baseline scorer (`baseline-v2`)

| Signal | Weight | Unusual when | Priors ramp (contribution 0 → 1) |
| --- | --- | --- | --- |
| `adjusted_paste_share` | 0.30 | high | 0.25 → 0.75 |
| `largest_unexplained_insert_share` | 0.20 | high | 0.20 → 0.60 |
| `max_growth_10s_share` | 0.15 | high | 0.30 → 0.80 |
| `typed_share_of_original` | 0.15 | low | 0.50 → 0.10 |
| `unattributed_insert_share` | 0.10 | high | 0.02 → 0.20 |
| `iki_cv` | 0.05 | low | 0.35 → 0.15 |
| `time_to_accept_min` | 0.05 | low | cohort only |

- **Cohort mode.** With at least 10 peers on the same problem who have usable
  data, each signal uses a robust z-score, (x − median) / max(1.4826·MAD,
  floor), ramping from z = 2 to z = 5. It is also gated by an absolute floor
  that is closed up to the priors start and fully open half-way between start
  and full (e.g. `adjusted_paste_share` 0.25 → 0.50). A value the priors would
  not flag is therefore never flagged just because peers paste even less; the
  cohort can only add sensitivity above the priors threshold.
- **Ruleset history.** `baseline-v1` opened the cohort floor at half the priors
  start. The Phase 6 synthetic evaluation showed that this flagged most
  ordinary small snippet pastes in low-paste cohorts, so `baseline-v2` raised
  it (see [docs/evaluation.md](evaluation.md)). Every stored assessment records
  its ruleset, so older `baseline-v1` rows remain interpretable. Assessments
  are append-only: existing rows are not rewritten, and any later re-score
  (e.g. the contest-end run) is stored as a new `baseline-v2` assessment.
- **Score.** 100 × Σ wᵢcᵢ / Σ wᵢ, over the signals that are available. A score of
  50 or more puts the subject in the band **"Elevated anomaly score — requires
  review"**; otherwise the band is "Typical".
- **What each assessment stores.** Score, band, the contribution of every
  signal (value, reference, points), evidence pointers (session and seq of the
  largest insertion and of the fastest-growth window), warnings, and the
  ruleset, feature-set and input versions.

**These weights and thresholds are uncalibrated.** They were chosen by reasoning
and have not been fitted to data. [docs/evaluation.md](evaluation.md) measures them on
clearly labelled synthetic scenarios, including where they fail. The project makes
no claim about real-world accuracy.

## Human review (Phase 5)

```
elevated assessment ──► review_case (open) ◄── reviewer opens manually
                              │
            reviewer records decision (rationale ≥ 30 chars, assessment version)
             ├── no concern / inconclusive ──────────────► closed
             └── confirmed violation ──► awaiting_confirmation
                                           │  a *different* admin
                                           ├── confirms ──► closed, takes effect
                                           └── rejects  ──► open again
closed ──(reopen with a reason)──► open ──► new decision supersedes the old one
```

- **Effect.** A violation takes effect only after confirmation. For each
  subject, the latest *final* decision wins: "no concern" or "inconclusive" at
  the time they were recorded, or a violation at the time it was confirmed.
  While a violation is in effect, that problem is excluded for that contestant
  in the standings (shown as ✕ / †). A later "no concern" reverses the effect.
  Nothing happens automatically on a score alone.
- **Contestant.** The contestant sees a neutral notice, the reviewer's rationale
  and whether the decision is still in effect, and can send written responses.
  Reviewer identities are not shown to them.
- **Safeguards.**
  - Decisions, confirmations, notes and responses are append-only (DB triggers).
  - A trigger rejects confirmation by the decision's author.
  - Separation of duties: nobody acts on their own work or a contest they
    created. They can read the case, but every action is refused.
  - Every view, decision, confirmation, note, reopen and response is audited
    (`/admin/audit`).
- **Queue rules.** Only the first elevated assessment of a subject opens a case,
  to avoid flapping. Later re-scores appear in the queue as "new since decision".

## Known limitations

- **Telemetry comes from the client and can be forged.** A determined user can
  emit "typed" events for pasted code. Features describe the record as received,
  not the truth.
- **Code typed from a second screen or another device** looks like ordinary
  typing. No browser-side system can see this.
- **Anomaly is not misconduct.** Experienced contestants with large personal
  libraries who haven't registered them, or people who draft code offline and
  paste it in, will look "elevated". That is why a human reviews every case and
  why templates exist.
- **Cohort scores move as peers are added.** History is kept, and the
  contest-end sweep produces the final score.
