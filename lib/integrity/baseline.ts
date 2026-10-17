// Transparent baseline scorer ("baseline-v1"). Pure and deterministic.
//
// Each signal maps one feature to a contribution in [0, 1]:
//  • priors mode (fewer than MIN_COHORT peers): a documented piecewise-linear
//    ramp between `start` (0) and `full` (1);
//  • cohort mode: robust z-score against peers on the same problem
//    (median / MAD), ramping from z = 2 (0) to z = 5 (1), and gated by a
//    lenient absolute floor so a cohort where nobody pastes cannot make a
//    small paste look anomalous.
// Score = 100 × Σ wᵢcᵢ / Σ wᵢ over available signals.
//
// THE THRESHOLDS AND WEIGHTS ARE UNCALIBRATED STARTING POINTS chosen by
// reasoning, not fitted to real data. Phase 6 measures them on clearly
// labelled synthetic scenarios. A score is a prompt for human review only.

import type { DataQuality, Extraction, FeatureName, Features } from "./features";

export const RULESET_VERSION = "baseline-v1";
export const MIN_COHORT = 10;
export const ELEVATED_THRESHOLD = 50;
/** Below this share of total signal weight being available, no score is produced. */
const MIN_AVAILABLE_WEIGHT = 0.5;

type Signal = {
  feature: FeatureName;
  weight: number;
  /** Which direction is unusual. */
  direction: "high" | "low";
  /** Priors-mode ramp: contribution 0 at `start`, 1 at `full`. */
  start: number;
  full: number;
  /** Minimum MAD-scale so near-constant cohorts do not explode z-scores. */
  minScale: number;
  cohortOnly?: boolean;
  label: string;
};

export const SIGNALS: readonly Signal[] = [
  { feature: "adjusted_paste_share", weight: 0.3, direction: "high", start: 0.25, full: 0.75, minScale: 0.05, label: "Much of the code was inserted rather than typed (after subtracting templates)" },
  { feature: "largest_unexplained_insert_share", weight: 0.2, direction: "high", start: 0.2, full: 0.6, minScale: 0.05, label: "A single large insertion not explained by templates" },
  { feature: "max_growth_10s_share", weight: 0.15, direction: "high", start: 0.3, full: 0.8, minScale: 0.05, label: "The code grew very quickly within a 10-second window" },
  { feature: "typed_share_of_original", weight: 0.15, direction: "low", start: 0.5, full: 0.1, minScale: 0.05, label: "Little of the non-template code was typed" },
  { feature: "unattributed_insert_share", weight: 0.1, direction: "high", start: 0.02, full: 0.2, minScale: 0.01, label: "Code appeared without any recorded typing, paste or drop" },
  { feature: "iki_cv", weight: 0.05, direction: "low", start: 0.35, full: 0.15, minScale: 0.05, label: "Unusually regular keystroke timing" },
  { feature: "time_to_accept_min", weight: 0.05, direction: "low", start: 0, full: 0, minScale: 1, cohortOnly: true, label: "Accepted much faster than peers on this problem" },
];

export type Band = "typical" | "elevated" | "insufficient_data";
export type Contribution = {
  feature: FeatureName;
  label: string;
  value: number | null;
  weight: number;
  contribution: number;
  points: number;
  mode: "priors" | "cohort" | "unavailable";
  reference: { start: number; full: number } | { median: number; scale: number; n: number; z: number } | null;
};
export type Assessment = {
  rulesetVersion: string;
  score: number | null;
  band: Band;
  contributions: Contribution[];
  reference: { mode: "priors" | "cohort" | "mixed"; cohortSize: number };
  warnings: { code: string; message: string }[];
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ramp = (x: number, start: number, full: number) => (start === full ? (x >= full ? 1 : 0) : clamp01((x - start) / (full - start)));

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Peers' values per feature (excluding the subject). */
export type Cohort = Partial<Record<FeatureName, number[]>>;

export function scoreAssessment(extraction: Pick<Extraction, "features" | "dataQuality">, cohort: Cohort = {}): Assessment {
  const { features, dataQuality } = extraction;
  const warnings: Assessment["warnings"] = [];
  const contributions: Contribution[] = [];
  const modes = new Set<"priors" | "cohort">();
  let cohortSize = 0;

  for (const s of SIGNALS) {
    const feat = features[s.feature];
    const peers = (cohort[s.feature] ?? []).filter((v) => Number.isFinite(v));
    const useCohort = peers.length >= MIN_COHORT;
    if (!feat.available || feat.value === null || (s.cohortOnly && !useCohort)) {
      contributions.push({ feature: s.feature, label: s.label, value: feat.value, weight: s.weight, contribution: 0, points: 0, mode: "unavailable", reference: null });
      continue;
    }
    const x = feat.value;
    const sign = s.direction === "high" ? 1 : -1;
    let c: number;
    let reference: Contribution["reference"];
    if (useCohort) {
      const med = medianOf(peers);
      const mad = medianOf(peers.map((v) => Math.abs(v - med)));
      const scale = Math.max(1.4826 * mad, s.minScale);
      const z = (sign * (x - med)) / scale;
      const zc = ramp(z, 2, 5);
      // Lenient absolute floor: half-way to the priors start, in the unusual direction.
      const floor = s.cohortOnly ? 1 : ramp(x, s.direction === "high" ? s.start / 2 : (s.start + 1) / 2, s.start);
      c = Math.min(zc, floor);
      reference = { median: med, scale: Math.round(scale * 1e4) / 1e4, n: peers.length, z: Math.round(z * 100) / 100 };
      modes.add("cohort");
      cohortSize = Math.max(cohortSize, peers.length);
    } else {
      c = ramp(x, s.start, s.full);
      reference = { start: s.start, full: s.full };
      modes.add("priors");
    }
    contributions.push({ feature: s.feature, label: s.label, value: x, weight: s.weight, contribution: Math.round(c * 1e4) / 1e4, points: 0, mode: useCohort ? "cohort" : "priors", reference });
  }

  const totalWeight = SIGNALS.reduce((n, s) => n + s.weight, 0);
  const available = contributions.filter((c) => c.mode !== "unavailable");
  const availableWeight = available.reduce((n, c) => n + c.weight, 0);
  for (const c of available) c.points = Math.round((100 * c.weight * c.contribution) / availableWeight * 10) / 10;
  contributions.sort((a, b) => b.points - a.points);

  const mode: Assessment["reference"]["mode"] = modes.size === 2 ? "mixed" : modes.has("cohort") ? "cohort" : "priors";
  if (mode !== "cohort") warnings.push({ code: "priors_used", message: `Fewer than ${MIN_COHORT} comparable contestants; fixed prior thresholds were used for some or all signals.` });

  if (dataQuality.insufficient || availableWeight < MIN_AVAILABLE_WEIGHT * totalWeight) {
    // Feature values computed from missing data are artefacts; never present them as points.
    for (const c of contributions) {
      c.points = 0;
      c.contribution = 0;
    }
    warnings.push({ code: "insufficient_data", message: insufficientMessage(dataQuality) });
    return { rulesetVersion: RULESET_VERSION, score: null, band: "insufficient_data", contributions, reference: { mode, cohortSize }, warnings };
  }

  const score = Math.round(available.reduce((n, c) => n + (100 * c.weight * c.contribution) / availableWeight, 0) * 10) / 10;
  return {
    rulesetVersion: RULESET_VERSION,
    score,
    band: score >= ELEVATED_THRESHOLD ? "elevated" : "typical",
    contributions,
    reference: { mode, cohortSize },
    warnings,
  };
}

function insufficientMessage(dq: DataQuality): string {
  if (!dq.components.linkedSession) return "The submission was not made from an instrumented editor session, so there is no activity to assess.";
  return `Telemetry covers too little of this submission's history to assess (coverage ${Math.round(dq.coverage * 100)}%). Missing data is not evidence of anything.`;
}

/** Human-readable reasons for the top contributions, for reviewers. */
export function explain(assessment: Pick<Assessment, "contributions" | "score">, features: Features): string[] {
  if (assessment.score === null) return [];
  return assessment.contributions
    .filter((c) => c.points > 0)
    .slice(0, 3)
    .map((c) => {
      const v = c.value === null ? "n/a" : c.value;
      const ref =
        c.reference && "median" in c.reference
          ? `peer median ${c.reference.median}, robust z ${c.reference.z}`
          : c.reference
            ? `prior threshold ${c.reference.start}→${c.reference.full}`
            : "";
      return `${c.label}: ${c.feature} = ${v} (${ref}; +${c.points} points). ${features[c.feature].explanation}`;
    });
}
