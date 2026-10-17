import { describe, expect, it } from "vitest";
import { ELEVATED_THRESHOLD, MIN_COHORT, scoreAssessment, explain } from "@/lib/integrity/baseline";
import { EDITOR_STARTER_TEMPLATE } from "@/lib/editor-template";
import { extractFeatures, pickTarget, type AnalysisInput, type AnalysisTemplate } from "@/lib/integrity/features";
import { templateCoverage, tokenize } from "@/lib/integrity/similarity";
import { SOLUTION, TimelineBuilder, sha, submissionFrom } from "../helpers/timeline";

const contest = { startsAt: new Date("2030-01-01T10:00:00Z"), endsAt: new Date("2030-01-01T13:00:00Z") };
const t0 = new Date("2030-01-01T10:05:00Z");
const starter: AnalysisTemplate = { kind: "starter", name: "starter", source: EDITOR_STARTER_TEMPLATE, sourceSha256: sha(EDITOR_STARTER_TEMPLATE) };
const input = (b: TimelineBuilder, submitSeq: number, templates: AnalysisTemplate[] = [starter], extra: Partial<AnalysisInput> = {}): AnalysisInput => ({
  contest,
  problem: { difficulty: 1200 },
  sessions: [b.build()],
  submissions: [submissionFrom(b, "sub-1", submitSeq)],
  templates,
  ...extra,
});

describe("template similarity", () => {
  it("ignores comments and whitespace", () => {
    expect(tokenize("int  a = 1; // hi\n/* x */ a++;")).toEqual(["int", "a", "=", "1", ";", "a", "++", ";"]);
    const reformatted = SOLUTION.replace(/\n/g, "\n\n").replace(/    /g, "\t") + "// trailing comment\n";
    expect(templateCoverage(reformatted, [SOLUTION]).coverage).toBe(1);
  });

  it("reports partial coverage for a template plus original code", () => {
    const c = templateCoverage(SOLUTION, [EDITOR_STARTER_TEMPLATE]);
    expect(c.coverage).toBeGreaterThan(0.15);
    expect(c.coverage).toBeLessThan(0.6);
    expect(templateCoverage(SOLUTION, []).coverage).toBe(0);
  });
});

describe("feature extraction", () => {
  it("is deterministic for the same input", () => {
    const build = () => {
      const b = new TimelineBuilder("s1", t0, 7).type(SOLUTION);
      return input(b, b.submitMarker());
    };
    expect(extractFeatures(build())).toEqual(extractFeatures(build()));
  });

  it("picks the first accepted submission, else the latest judged one", () => {
    const base = { kind: "submission" as const, status: "judged", source: "", sourceSha256: "", ideSessionId: null, ideSeq: null };
    const subs = [
      { ...base, id: "a", createdAt: new Date(1), verdict: "wrong_answer" },
      { ...base, id: "b", createdAt: new Date(2), verdict: "accepted" },
      { ...base, id: "c", createdAt: new Date(3), verdict: "accepted" },
    ];
    expect(pickTarget(subs)?.id).toBe("b");
    expect(pickTarget(subs.slice(0, 1))?.id).toBe("a");
    expect(pickTarget([{ ...base, id: "s", kind: "sample_run", createdAt: new Date(1), verdict: "accepted" }])).toBeNull();
  });

  it("an ordinary typed solution: mostly typed, small insertions, human rhythm", () => {
    const b = new TimelineBuilder("s1", t0, 3).type(SOLUTION);
    const x = extractFeatures(input(b, b.submitMarker()))!;
    expect(x.features.typed_share_of_original.value).toBeGreaterThan(0.95);
    expect(x.features.adjusted_paste_share.value).toBe(0);
    expect(x.features.iki_cv.value).toBeGreaterThan(0.3);
    expect(x.features.typing_bursts.value).toBeGreaterThan(0);
    expect(x.dataQuality).toMatchObject({ insufficient: false, components: { linkedSession: true, snapshotMatches: true } });
  });

  it("subtracts registered templates before measuring pastes", () => {
    const template = SOLUTION; // the contestant pasted their own registered template (e.g. a solved-before routine)
    const b = new TimelineBuilder("s1", t0, 4).paste(template);
    const withTemplate = extractFeatures(input(b, b.submitMarker(), [starter, { kind: "personal", name: "kadane", source: template, sourceSha256: sha(template) }]))!;
    expect(withTemplate.features.template_coverage.value).toBe(1);
    expect(withTemplate.features.adjusted_paste_share.value).toBe(0);
    expect(withTemplate.features.largest_unexplained_insert_share.value).toBe(0);

    const b2 = new TimelineBuilder("s1", t0, 4).paste(template);
    const without = extractFeatures(input(b2, b2.submitMarker(), [starter]))!;
    expect(without.features.adjusted_paste_share.value).toBeGreaterThan(0.5);
  });

  it("separates unattributed insertions from pastes", () => {
    const b = new TimelineBuilder("s1", t0, 5).type("// start\n").inject(SOLUTION);
    const x = extractFeatures(input(b, b.submitMarker()))!;
    expect(x.features.unattributed_chars.value).toBe(SOLUTION.length);
    expect(x.features.pasted_chars.value).toBe(0);
    expect(x.features.unattributed_insert_share.value).toBeGreaterThan(0.9);
  });

  it("records leaving the page before a large insertion as context evidence", () => {
    const b = new TimelineBuilder("s1", t0, 6).type("int main() {\n").blur().wait(20_000).focus().paste(SOLUTION.slice(40));
    const x = extractFeatures(input(b, b.submitMarker()))!;
    expect(x.features.blur_before_large_insert.value).toBe(1);
    // 20 s away, then the focus and paste steps (~0.5 s) → reported as 20–21 s.
    const ev = x.evidence.find((e) => e.kind === "blur_before_insert");
    expect(ev && "secondsAfterBlur" in ev ? ev.secondsAfterBlur : -1).toBeGreaterThanOrEqual(20);
  });

  it("reports missing telemetry as a data-quality problem, not a signal", () => {
    const b = new TimelineBuilder("s1", t0, 8).type(SOLUTION);
    const seq = b.submitMarker();
    const noSession = extractFeatures({ ...input(b, seq), sessions: [], submissions: [{ ...submissionFrom(b, "x", seq), ideSessionId: null, ideSeq: null }] })!;
    expect(noSession.dataQuality.insufficient).toBe(true);
    expect(noSession.dataQuality.warnings.map((w) => w.code)).toContain("submitted_without_session");

    const mismatched = extractFeatures({ ...input(b, seq), submissions: [submissionFrom(b, "y", seq, "accepted", SOLUTION + "\n// edited outside\n")] })!;
    expect(mismatched.dataQuality.components.snapshotMatches).toBe(false);
    expect(mismatched.dataQuality.coverage).toBeLessThanOrEqual(0.3);
  });

  it("counts runs and rejected attempts before the assessed submission, excluding compilation errors", () => {
    const b = new TimelineBuilder("s1", t0, 9).type(SOLUTION);
    const seq = b.submitMarker();
    const target = submissionFrom(b, "ac", seq);
    // Earlier attempts, placed relative to the accepted submission's time.
    const mk = (id: string, kind: "submission" | "sample_run", verdict: string, minutesBefore: number) => ({ ...target, id, kind, verdict, createdAt: new Date(target.createdAt.getTime() - minutesBefore * 60_000) });
    const after = { ...target, id: "late", verdict: "wrong_answer", createdAt: new Date(target.createdAt.getTime() + 60_000) };
    const x = extractFeatures({ ...input(b, seq), submissions: [mk("r", "sample_run", "accepted", 3), mk("w", "submission", "wrong_answer", 2), mk("ce", "submission", "compilation_error", 1), target, after] })!;
    expect(x.features).toMatchObject({ runs_before: { value: 1 }, rejected_before: { value: 1 }, compile_errors_before: { value: 1 } });
    expect(x.features.time_to_accept_min.value).toBeGreaterThan(0);
  });
});

describe("baseline scorer", () => {
  const typed = () => {
    const b = new TimelineBuilder("s1", t0, 11).type(SOLUTION);
    return extractFeatures(input(b, b.submitMarker()))!;
  };
  const pastedWhole = () => {
    const b = new TimelineBuilder("s1", t0, 12).type("int main() {\n").paste(SOLUTION);
    return extractFeatures(input(b, b.submitMarker()))!;
  };

  it("scores an ordinary typed solution as typical and a whole-solution paste as elevated (priors mode)", () => {
    const ok = scoreAssessment(typed());
    expect(ok.band).toBe("typical");
    expect(ok.score).toBeLessThan(ELEVATED_THRESHOLD);
    expect(ok.reference.mode).toBe("priors");
    expect(ok.warnings.map((w) => w.code)).toContain("priors_used");

    const bad = scoreAssessment(pastedWhole());
    expect(bad.band).toBe("elevated");
    expect(bad.score).toBeGreaterThanOrEqual(ELEVATED_THRESHOLD);
    expect(bad.contributions[0]!.points).toBeGreaterThan(0);
  });

  it("does not elevate a paste of the contestant's own registered template", () => {
    const b = new TimelineBuilder("s1", t0, 13).paste(SOLUTION);
    const x = extractFeatures(input(b, b.submitMarker(), [starter, { kind: "personal", name: "mine", source: SOLUTION, sourceSha256: sha(SOLUTION) }]))!;
    expect(scoreAssessment(x).band).toBe("typical");
  });

  it("produces no score when data is insufficient", () => {
    const x = typed();
    const a = scoreAssessment({ ...x, dataQuality: { ...x.dataQuality, insufficient: true, coverage: 0.2 } });
    expect(a).toMatchObject({ score: null, band: "insufficient_data" });
    expect(a.warnings.map((w) => w.code)).toContain("insufficient_data");
    // No partial points or explanations for an unscored assessment.
    expect(a.contributions.every((c) => c.points === 0 && c.contribution === 0)).toBe(true);
    expect(explain(a, x.features)).toEqual([]);
  });

  it("switches to cohort mode with enough peers, using robust z-scores with an absolute floor", () => {
    const x = pastedWhole();
    const peers = (v: number) => Array.from({ length: MIN_COHORT }, (_, i) => v + i * 0.001);
    // A cohort where everyone pasted the same amount: not unusual relative to peers.
    const sameAsPeers = scoreAssessment(x, { adjusted_paste_share: peers(x.features.adjusted_paste_share.value!) });
    const c = sameAsPeers.contributions.find((k) => k.feature === "adjusted_paste_share")!;
    expect(c.mode).toBe("cohort");
    expect(c.contribution).toBe(0);
    expect(sameAsPeers.reference.mode).toBe("mixed");

    // A cohort of near-zero pasters, and a subject with a tiny paste: below the absolute floor.
    const tiny = typed();
    const tinyPaste = { ...tiny, features: { ...tiny.features, adjusted_paste_share: { ...tiny.features.adjusted_paste_share, value: 0.08 } } };
    const r = scoreAssessment(tinyPaste, { adjusted_paste_share: peers(0) });
    expect(r.contributions.find((k) => k.feature === "adjusted_paste_share")!.contribution).toBe(0);
  });

  it("explains its top contributions in plain language", () => {
    const x = pastedWhole();
    const lines = explain(scoreAssessment(x), x.features);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatch(/points/);
  });

  it("is deterministic", () => {
    expect(scoreAssessment(pastedWhole())).toEqual(scoreAssessment(pastedWhole()));
  });
});
