// SYNTHETIC DATA ONLY. Generates a labelled evaluation dataset by running the
// *production* feature extractor and baseline scorer on simulated sessions.
//
//   npm run eval:generate -- [--seed 42] [--contestants 300] [--out ml/data/synthetic-v1.jsonl]
//
// Output: one JSON object per (contestant, problem), tagged synthetic: true.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { EDITOR_STARTER_TEMPLATE } from "@/lib/editor-template";
import { RULESET_VERSION, scoreAssessment, type Cohort } from "@/lib/integrity/baseline";
import { FEATURE_NAMES, FEATURE_SET_VERSION, extractFeatures, type AnalysisInput, type AnalysisSubmission, type Extraction } from "@/lib/integrity/features";
import { TimelineBuilder, rng, sha } from "./builder";
import { PROBLEMS, TEMPLATES, solutionOf, type TemplateName } from "./corpus";
import { SCENARIOS, type Profile, type Scenario } from "./scenarios";

export const DATASET_VERSION = "synthetic-v1";
const CONTEST = { startsAt: new Date("2030-06-01T10:00:00Z"), endsAt: new Date("2030-06-01T13:00:00Z") };

/** Legitimate scenario mix (relative weights). */
const LEGIT_WEIGHTS: Record<string, number> = {
  L_typed: 40,
  L_templates: 15,
  L_library: 10,
  L_debug: 12,
  L_fast: 6,
  L_autocomplete: 8,
  L_reading: 8,
  L_snippets: 4,
  L_offline_draft: 2,
};
const MISCONDUCT_WEIGHTS: Record<string, number> = { M_paste_all: 30, M_partial: 25, M_robotic: 10, M_inject: 8, M_paste_edit: 15, M_humanlike: 12 };

export type GenerateOptions = { seed: number; contestants: number; misconductProneShare?: number };

export type DatasetRecord = {
  dataset: string;
  synthetic: true;
  id: string;
  contestant: string;
  problem: string;
  difficulty: number;
  scenario: string;
  label: 0 | 1;
  degraded: "none" | "missing_events" | "no_session";
  features: Record<string, number | null>;
  coverage: number;
  insufficient: boolean;
  baselinePriors: { score: number | null; band: string };
  baselineCohort: { score: number | null; band: string; cohortMode: string; cohortSize: number };
};

function weighted(rand: () => number, weights: Record<string, number>, allowed: (id: string) => boolean): string {
  const entries = Object.entries(weights).filter(([id]) => allowed(id));
  const total = entries.reduce((n, [, w]) => n + w, 0);
  let r = rand() * total;
  for (const [id, w] of entries) if ((r -= w) <= 0) return id;
  return entries.at(-1)![0];
}

function makeProfile(rand: () => number): Profile {
  const registered: TemplateName[] = rand() < 0.55 ? (["fastio", "dsu", "segtree", "modpow"] as const).filter(() => rand() < 0.6) : [];
  const libraryFor = new Set(PROBLEMS.filter((p) => p.uses.length > 1 && rand() < 0.4).map((p) => p.id));
  return {
    style: { meanMs: 110 + rand() * 170, jitter: 0.35 + rand() * 0.55, typoRate: 0.005 + rand() * 0.045, pauseRate: 0.005 + rand() * 0.035 },
    registered,
    libraryFor,
  };
}

type Built = { record: Omit<DatasetRecord, "baselineCohort">; extraction: Extraction };

function buildOne(contestant: number, problemIdx: number, scenario: Scenario, profile: Profile, seed: number): Built | null {
  const p = PROBLEMS[problemIdx]!;
  const rand = rng(seed);
  const start = new Date(CONTEST.startsAt.getTime() + Math.floor(rand() * 90) * 60_000);
  const sessionId = `s-${contestant}-${p.id}`;
  const b = new TimelineBuilder(sessionId, start, seed);
  const result = scenario.build({ b, p, profile, rand });
  const submitSeq = b.submitMarker();

  // Telemetry degradation, independent of the label.
  let degraded: DatasetRecord["degraded"] = "none";
  const roll = rand();
  let session = b.build();
  if (roll < 0.06 && session.events.length > 20) {
    degraded = "missing_events";
    const len = Math.floor(session.events.length * (0.05 + rand() * 0.35));
    const from = 1 + Math.floor(rand() * (session.events.length - len - 3));
    session = { ...session, events: session.events.filter((e) => e.seq < from || e.seq >= from + len) };
  } else if (roll < 0.09) {
    degraded = "no_session";
  }

  const finalSource = b.source;
  const submittedAt = new Date(b.now.getTime() + 1_000);
  const verdictOf = { sample_run: "accepted", wrong_answer: "wrong_answer", compilation_error: "compilation_error" } as const;
  const prior: AnalysisSubmission[] = result.priorAttempts.map((kind, i) => ({
    id: `${sessionId}-a${i}`,
    kind: kind === "sample_run" ? "sample_run" : "submission",
    createdAt: new Date(submittedAt.getTime() - (result.priorAttempts.length - i) * 120_000),
    status: "judged",
    verdict: verdictOf[kind],
    source: finalSource,
    sourceSha256: sha(finalSource),
    ideSessionId: degraded === "no_session" ? null : sessionId,
    ideSeq: null,
  }));
  const final: AnalysisSubmission = {
    id: `${sessionId}-final`,
    kind: "submission",
    createdAt: submittedAt,
    status: "judged",
    verdict: "accepted",
    source: finalSource,
    sourceSha256: sha(finalSource),
    ideSessionId: degraded === "no_session" ? null : sessionId,
    ideSeq: degraded === "no_session" ? null : submitSeq,
  };

  const templates = [
    { kind: "starter" as const, name: "starter", source: EDITOR_STARTER_TEMPLATE, sourceSha256: sha(EDITOR_STARTER_TEMPLATE) },
    ...result.personalTemplates.map((t) => ({ kind: "personal" as const, name: t.name, source: t.source, sourceSha256: sha(t.source) })),
  ];
  const input: AnalysisInput = {
    contest: CONTEST,
    problem: { difficulty: p.difficulty },
    sessions: degraded === "no_session" ? [] : [session],
    submissions: [...prior, final],
    templates,
  };
  const extraction = extractFeatures(input);
  if (!extraction) return null;
  const priors = scoreAssessment(extraction);
  return {
    extraction,
    record: {
      dataset: DATASET_VERSION,
      synthetic: true,
      id: `${DATASET_VERSION}:${contestant}:${p.id}`,
      contestant: `c${contestant}`,
      problem: p.id,
      difficulty: p.difficulty,
      scenario: scenario.id,
      label: scenario.label,
      degraded,
      features: Object.fromEntries(FEATURE_NAMES.map((n) => [n, extraction.features[n].available ? extraction.features[n].value : null])),
      coverage: extraction.dataQuality.coverage,
      insufficient: extraction.dataQuality.insufficient,
      baselinePriors: { score: priors.score, band: priors.band },
    },
  };
}

export function generateDataset({ seed, contestants, misconductProneShare = 0.1 }: GenerateOptions): DatasetRecord[] {
  const rand = rng(seed);
  const built: Built[] = [];
  for (let c = 0; c < contestants; c++) {
    const profile = makeProfile(rand);
    // Misconduct is clustered: a few contestants account for most of it, so contestant-grouped splits matter.
    const prone = rand() < misconductProneShare;
    const problems = PROBLEMS.map((_, i) => i).filter(() => rand() < 0.75);
    for (const pi of problems) {
      const p = PROBLEMS[pi]!;
      const misconduct = rand() < (prone ? 0.6 : 0.01);
      const id = misconduct
        ? weighted(rand, MISCONDUCT_WEIGHTS, () => true)
        : weighted(rand, LEGIT_WEIGHTS, (sid) => SCENARIOS.find((s) => s.id === sid)!.eligible?.(p, profile) ?? true);
      const scenario = SCENARIOS.find((s) => s.id === id)!;
      const b = buildOne(c, pi, scenario, profile, Math.floor(rand() * 2 ** 31));
      if (b) built.push(b);
    }
  }

  // Cohort mode, as in production: peers on the same problem, excluding the subject and peers with insufficient data.
  return built.map(({ record, extraction }) => {
    const cohort: Cohort = {};
    for (const peer of built) {
      if (peer.record.problem !== record.problem || peer.record.id === record.id || peer.record.insufficient) continue;
      for (const n of FEATURE_NAMES) {
        const v = peer.extraction.features[n];
        if (v.available && v.value !== null) (cohort[n] ??= []).push(v.value);
      }
    }
    const scored = scoreAssessment(extraction, cohort);
    return { ...record, baselineCohort: { score: scored.score, band: scored.band, cohortMode: scored.reference.mode, cohortSize: scored.reference.cohortSize } };
  });
}

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("eval/generate.ts")) {
  const seed = Number(arg("seed", "42"));
  const contestants = Number(arg("contestants", "1000"));
  const out = arg("out", "ml/data/synthetic-v1.jsonl");
  const t0 = Date.now();
  const records = generateDataset({ seed, contestants });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const byScenario: Record<string, number> = {};
  for (const r of records) byScenario[r.scenario] = (byScenario[r.scenario] ?? 0) + 1;
  const manifest = {
    dataset: DATASET_VERSION,
    synthetic: true,
    note: "SYNTHETIC: simulated editor behaviour, not real contestants. Results on this data are not real-world accuracy.",
    seed,
    contestants,
    records: records.length,
    positives: records.filter((r) => r.label === 1).length,
    featureSetVersion: FEATURE_SET_VERSION,
    rulesetVersion: RULESET_VERSION,
    byScenario,
    scenarioDescriptions: Object.fromEntries(SCENARIOS.map((sc) => [sc.id, sc.description])),
    templates: Object.keys(TEMPLATES),
    problems: PROBLEMS.map((p) => ({ id: p.id, difficulty: p.difficulty, length: solutionOf(p).length })),
  };
  writeFileSync(out.replace(/\.jsonl$/, ".manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${records.length} records (${manifest.positives} simulated misconduct) → ${out} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
