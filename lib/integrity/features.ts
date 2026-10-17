// Deterministic behavioural features for one assessment subject
// (contestant × contest × problem). Pure: same input → same output.
//
// Features describe *how the submitted code came to exist in the editor*.
// None of them is evidence of misconduct on its own; template-covered code
// is subtracted before anything paste-related is measured.

import { analyzeSessionQuality, type QualityWarning } from "@/lib/telemetry/quality";
import { templateCoverage } from "./similarity";

export const FEATURE_SET_VERSION = "features-v1";

export type AnalysisEvent = { seq: number; type: string; clientTs: Date; receivedAt: Date; arrival: number; payload: Record<string, unknown> };
export type AnalysisSession = { id: string; startedAt: Date; maxSeq: number; purged: boolean; events: AnalysisEvent[] };
export type AnalysisSubmission = {
  id: string;
  kind: "submission" | "sample_run";
  createdAt: Date;
  status: string;
  verdict: string | null;
  source: string;
  sourceSha256: string;
  ideSessionId: string | null;
  ideSeq: number | null;
};
export type AnalysisTemplate = { kind: "personal" | "snippet" | "starter"; name: string; sourceSha256: string; source: string };
export type AnalysisInput = {
  contest: { startsAt: Date; endsAt: Date };
  problem: { difficulty: number | null };
  sessions: AnalysisSession[];
  submissions: AnalysisSubmission[];
  templates: AnalysisTemplate[];
};

export const FEATURE_NAMES = [
  "final_length",
  "template_coverage",
  "typed_chars",
  "pasted_chars",
  "paste_count",
  "unattributed_chars",
  "adjusted_paste_share",
  "largest_unexplained_insert_share",
  "unattributed_insert_share",
  "typed_share_of_original",
  "max_growth_10s_share",
  "iki_median_ms",
  "iki_cv",
  "typing_bursts",
  "revision_ratio",
  "undo_count",
  "runs_before",
  "rejected_before",
  "compile_errors_before",
  "time_to_accept_min",
  "blur_before_large_insert",
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];
export type Feature = { value: number | null; available: boolean; explanation: string };
export type Features = Record<FeatureName, Feature>;

export type DataQuality = {
  coverage: number;
  insufficient: boolean;
  components: { linkedSession: boolean; snapshotMatches: boolean | null; completeness: number; reconstruction: number | null };
  warnings: (QualityWarning | { code: "submitted_without_session" | "no_telemetry"; severity: "warning"; message: string })[];
};

export type EvidenceRef =
  | { kind: "largest_insert"; sessionId: string; seq: number; chars: number; origin: string; at: string }
  | { kind: "growth_window"; sessionId: string; fromSeq: number; toSeq: number; chars: number; seconds: number }
  | { kind: "blur_before_insert"; sessionId: string; seq: number; chars: number; secondsAfterBlur: number };

export type Extraction = {
  target: { submissionId: string; accepted: boolean; createdAt: string };
  features: Features;
  dataQuality: DataQuality;
  evidence: EvidenceRef[];
};

const LARGE_INSERT = 200;
const BURST_GAP_MS = 5_000;
const MIN_INTERVALS = 30;
const GROWTH_WINDOW_MS = 10_000;
const BLUR_LOOKBACK_MS = 60_000;
const REJECTED = new Set(["wrong_answer", "time_limit_exceeded", "memory_limit_exceeded", "runtime_error"]);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const f = (value: number | null, explanation: string): Feature => ({ value, available: value !== null, explanation });
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

type Edit = { sessionId: string; seq: number; t: number; origin: string; inserted: number; deleted: number; docLength: number };

/** The submission being assessed: the first accepted one, else the latest judged submission. */
export function pickTarget(submissions: AnalysisSubmission[]): AnalysisSubmission | null {
  const real = submissions.filter((s) => s.kind === "submission").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return real.find((s) => s.verdict === "accepted") ?? [...real].reverse().find((s) => s.status === "judged") ?? null;
}

export function extractFeatures(input: AnalysisInput): Extraction | null {
  const target = pickTarget(input.submissions);
  if (!target) return null;
  const cutoff = target.createdAt.getTime();
  const accepted = target.verdict === "accepted";
  const finalLength = target.source.length;

  // Events that can have contributed to the target: everything before it was submitted.
  // In the target's own session the seq of its submit marker is exact; elsewhere use time.
  const sessions = [...input.sessions].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const inScope = (s: AnalysisSession, e: AnalysisEvent) =>
    s.id === target.ideSessionId && target.ideSeq != null ? e.seq <= target.ideSeq : e.clientTs.getTime() <= cutoff;

  const edits: Edit[] = [];
  const blurs: { sessionId: string; t: number }[] = [];
  for (const s of sessions) {
    const events = s.events.filter((e) => inScope(s, e)).sort((a, b) => a.seq - b.seq);
    for (const e of events) {
      if (e.type === "edit") {
        edits.push({ sessionId: s.id, seq: e.seq, t: e.clientTs.getTime(), origin: String(e.payload.origin ?? "other"), inserted: num(e.payload.inserted), deleted: num(e.payload.deleted), docLength: num(e.payload.docLength) });
      } else if (e.type === "blur" || (e.type === "visibility" && e.payload.state === "hidden")) {
        blurs.push({ sessionId: s.id, t: e.clientTs.getTime() });
      }
    }
  }

  // ---- composition of inserted text
  const sumBy = (pred: (o: string) => boolean) => edits.filter((e) => pred(e.origin)).reduce((n, e) => n + e.inserted, 0);
  const typed = sumBy((o) => o === "input.type" || o === "input" || o === "input.complete");
  const pasted = sumBy((o) => o === "input.paste");
  const dropped = sumBy((o) => o === "input.drop");
  // Insertions with no user-event annotation (e.g. scripted dispatches) cannot be attributed.
  const unattributed = sumBy((o) => o === "other" || o === "set");
  const bulky = edits.filter((e) => e.origin === "input.paste" || e.origin === "input.drop" || e.origin === "other" || e.origin === "set");
  const largest = bulky.reduce<Edit | null>((m, e) => (!m || e.inserted > m.inserted ? e : m), null);

  const templates = input.templates.map((t) => t.source);
  const cov = templateCoverage(target.source, templates);
  const coveredChars = Math.round(cov.coverage * finalLength);
  const original = Math.max(1, finalLength - coveredChars);
  const denom = Math.max(finalLength, 1);

  // ---- fastest growth of the document within any 10 s window (two pointers, per session)
  let growth: { chars: number; e0: Edit; e1: Edit } | null = null;
  for (const sid of new Set(edits.map((e) => e.sessionId))) {
    const es = edits.filter((e) => e.sessionId === sid);
    let i = 0;
    for (let j = 0; j < es.length; j++) {
      while (es[j]!.t - es[i]!.t > GROWTH_WINDOW_MS) i++;
      const before = es[i]!.docLength - es[i]!.inserted + es[i]!.deleted;
      const g = es[j]!.docLength - before;
      if (!growth || g > growth.chars) growth = { chars: g, e0: es[i]!, e1: es[j]! };
    }
  }
  const unexplainedGrowth = Math.max(0, (growth?.chars ?? 0) - coveredChars);

  // ---- typing rhythm from single-keystroke edits
  const intervals: number[] = [];
  let bursts = 0;
  let run = 0;
  for (let k = 1; k < edits.length; k++) {
    const a = edits[k - 1]!;
    const b = edits[k]!;
    const keystroke = (e: Edit) => e.origin === "input.type" && e.inserted <= 2;
    if (!keystroke(a) || !keystroke(b) || a.sessionId !== b.sessionId) continue;
    const gap = b.t - a.t;
    if (gap > 0 && gap <= BURST_GAP_MS) {
      intervals.push(gap);
      run++;
    } else {
      if (run >= 5) bursts++;
      run = 0;
    }
  }
  if (run >= 5) bursts++;
  const sorted = [...intervals].sort((x, y) => x - y);
  const enough = intervals.length >= MIN_INTERVALS;
  const median = enough ? sorted[Math.floor(sorted.length / 2)]! : null;
  const mean = intervals.reduce((n, x) => n + x, 0) / Math.max(1, intervals.length);
  const sd = Math.sqrt(intervals.reduce((n, x) => n + (x - mean) ** 2, 0) / Math.max(1, intervals.length));

  // ---- workflow
  const before = input.submissions.filter((s) => s.createdAt.getTime() < cutoff);
  const runs = before.filter((s) => s.kind === "sample_run").length;
  const rejected = before.filter((s) => s.kind === "submission" && s.verdict && REJECTED.has(s.verdict)).length;
  const compileErrors = before.filter((s) => s.verdict === "compilation_error").length;
  const firstOpen = sessions[0]?.startedAt.getTime() ?? input.contest.startsAt.getTime();
  const startRef = Math.max(input.contest.startsAt.getTime(), Math.min(firstOpen, cutoff));

  // ---- leaving the page shortly before a large insertion (context only; permitted tools cause this too)
  const blurEvidence: EvidenceRef[] = [];
  for (const e of bulky.filter((x) => x.inserted >= LARGE_INSERT)) {
    const prior = blurs.filter((b) => b.sessionId === e.sessionId && b.t <= e.t && e.t - b.t <= BLUR_LOOKBACK_MS).pop();
    if (prior) blurEvidence.push({ kind: "blur_before_insert", sessionId: e.sessionId, seq: e.seq, chars: e.inserted, secondsAfterBlur: Math.round((e.t - prior.t) / 1000) });
  }

  const insertedTotal = edits.reduce((n, e) => n + (e.origin === "undo" || e.origin === "redo" ? 0 : e.inserted), 0);
  const deletedTotal = edits.reduce((n, e) => n + e.deleted, 0);

  const features: Features = {
    final_length: f(finalLength, "Length of the assessed submission in characters."),
    template_coverage: f(round(cov.coverage), "Share of the submission matching registered templates, approved snippets or the starter code (token 6-grams)."),
    typed_chars: f(typed, "Characters entered by typing or auto-completion."),
    pasted_chars: f(pasted + dropped, "Characters entered by paste or drag-and-drop."),
    paste_count: f(edits.filter((e) => e.origin === "input.paste" || e.origin === "input.drop").length, "Number of paste/drop operations."),
    unattributed_chars: f(unattributed, "Characters inserted without any user-input annotation (not typed, pasted or dropped)."),
    adjusted_paste_share: f(
      round(Math.min(1, Math.max(0, pasted + dropped + unattributed - coveredChars) / denom)),
      "Pasted, dropped or unattributed characters not explained by templates, as a share of the final code.",
    ),
    largest_unexplained_insert_share: f(
      round(Math.min(1, Math.max(0, (largest?.inserted ?? 0) - coveredChars) / denom)),
      "Largest single non-typed insertion, minus template-covered code, as a share of the final code.",
    ),
    unattributed_insert_share: f(round(Math.min(1, unattributed / denom)), "Unattributed insertions as a share of the final code."),
    typed_share_of_original: f(round(Math.min(1, typed / original)), "Typed characters relative to the part of the final code not covered by templates."),
    max_growth_10s_share: f(round(Math.min(1, unexplainedGrowth / denom)), "Largest increase in code length within any 10-second window, minus template-covered code, as a share of the final code."),
    iki_median_ms: f(median, enough ? "Median time between consecutive keystrokes during typing bursts." : `Needs at least ${MIN_INTERVALS} keystroke intervals.`),
    iki_cv: f(enough ? round(sd / mean) : null, enough ? "Variability of keystroke timing (std / mean). Human typing is irregular." : `Needs at least ${MIN_INTERVALS} keystroke intervals.`),
    typing_bursts: f(bursts, "Runs of at least 5 keystrokes without a pause longer than 5 s."),
    revision_ratio: f(round(deletedTotal / Math.max(1, insertedTotal)), "Deleted characters relative to inserted characters (how much was rewritten)."),
    undo_count: f(edits.filter((e) => e.origin === "undo").length, "Number of undo operations."),
    runs_before: f(runs, "Example runs before the assessed submission."),
    rejected_before: f(rejected, "Rejected submissions (WA/TLE/MLE/RE) before the assessed submission."),
    compile_errors_before: f(compileErrors, "Submissions with compilation errors before the assessed submission."),
    time_to_accept_min: f(accepted ? round((cutoff - startRef) / 60_000, 2) : null, accepted ? "Minutes from first opening the problem (or contest start) to the accepted submission." : "Not accepted."),
    blur_before_large_insert: f(blurEvidence.length, "Large insertions within 60 s after the editor lost focus or the page was hidden. Context only: permitted tools cause this too."),
  };

  // ---- data quality: how much of the target's history the telemetry actually covers
  const targetSession = sessions.find((s) => s.id === target.ideSessionId) ?? null;
  const warnings: DataQuality["warnings"] = [];
  let snapshotMatches: boolean | null = null;
  let reconstruction: number | null = null;
  if (!targetSession) {
    warnings.push({ code: "submitted_without_session", severity: "warning", message: "The assessed submission is not linked to an editor session." });
  } else {
    const snap = targetSession.events
      .filter((e) => e.type === "snapshot" && (target.ideSeq == null || e.seq < target.ideSeq) && (e.payload.reason === "submit" || e.payload.reason === "run"))
      .sort((a, b) => b.seq - a.seq)[0];
    snapshotMatches = snap ? snap.payload.sha256 === target.sourceSha256 : null;
    const lastEdit = edits.filter((e) => e.sessionId === targetSession.id).pop();
    if (lastEdit) reconstruction = round(Math.min(lastEdit.docLength, finalLength) / Math.max(lastEdit.docLength, finalLength, 1));
  }
  if (edits.length === 0) warnings.push({ code: "no_telemetry", severity: "warning", message: "No editing activity was recorded for this problem before the submission." });
  for (const s of sessions) {
    warnings.push(...analyzeSessionQuality({ events: s.events, maxSeq: s.maxSeq, snapshots: [], submissions: [], purged: s.purged }));
  }
  const expected = sessions.reduce((n, s) => n + s.maxSeq + 1, 0);
  const received = sessions.reduce((n, s) => n + s.events.length, 0);
  const completeness = expected > 0 ? round(received / expected) : 0;
  const coverage = !targetSession || edits.length === 0 || sessions.some((s) => s.purged)
    ? 0
    : round(Math.min(completeness, snapshotMatches === false ? 0.3 : snapshotMatches === null ? 0.7 : 1, reconstruction ?? 0.7));

  const evidence: EvidenceRef[] = [];
  if (largest) evidence.push({ kind: "largest_insert", sessionId: largest.sessionId, seq: largest.seq, chars: largest.inserted, origin: largest.origin, at: new Date(largest.t).toISOString() });
  if (growth && growth.chars > 0) {
    evidence.push({ kind: "growth_window", sessionId: growth.e0.sessionId, fromSeq: growth.e0.seq, toSeq: growth.e1.seq, chars: growth.chars, seconds: round((growth.e1.t - growth.e0.t) / 1000, 1) });
  }
  evidence.push(...blurEvidence);

  return {
    target: { submissionId: target.id, accepted, createdAt: target.createdAt.toISOString() },
    features,
    dataQuality: { coverage, insufficient: coverage < 0.5, components: { linkedSession: !!targetSession, snapshotMatches, completeness, reconstruction }, warnings },
    evidence,
  };
}
