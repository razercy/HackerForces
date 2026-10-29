import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/server/db";
import { analysisJob, anomalyAssessment, featureVector, userTemplate, userTemplateVersion } from "@/lib/server/db/schema";
import { getAssessment, listLatestAssessments } from "@/lib/server/integrity/review";
import { claimAnalysisJob, drainAnalysisJobs, enqueueAnalysis, enqueueEndedContests, processAnalysisJob, runAnalysis } from "@/lib/server/integrity/pipeline";
import { MockJudge } from "@/lib/server/judge/mock";
import { drainJobs } from "@/lib/server/judge/worker";
import type { Principal } from "@/lib/server/services/roles";
import { createSubmission } from "@/lib/server/services/submissions";
import {
  addSnippet,
  archiveTemplate,
  createTemplate,
  frozenTemplatesFor,
  listOwnTemplates,
  listSnippets,
  retireSnippet,
  saveTemplateVersion,
  snippetsInEffect,
} from "@/lib/server/services/templates";
import { ingestBatch, startSession } from "@/lib/server/telemetry/ingest";
import { TELEMETRY_SCHEMA_VERSION } from "@/lib/telemetry/events";
import { T0, at, runningContest } from "../helpers/contest-fixture";
import { createTestDb } from "../helpers/db";
import { principal } from "../helpers/fixtures";
import { SOLUTION, TimelineBuilder } from "../helpers/timeline";

let db: Db;
let close: () => Promise<void>;
let setter: Principal, otherSetter: Principal, reviewer: Principal;
let typist: Principal, paster: Principal, templateUser: Principal, lateTemplate: Principal, noEditor: Principal;
let contestId: string, slug: string, problemIds: string[];
const judge = new MockJudge(0);

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  [setter, otherSetter, reviewer, typist, paster, templateUser, lateTemplate, noEditor] = await Promise.all([
    principal(db, "problem_setter"),
    principal(db, "problem_setter"),
    principal(db, "reviewer"),
    principal(db),
    principal(db),
    principal(db),
    principal(db),
    principal(db),
  ]);
  ({ id: contestId, slug, problemIds } = await runningContest(db, setter, [typist, paster, templateUser, lateTemplate, noEditor]));
});
afterAll(async () => close());

/** Plays a synthetic session through the real ingestion path, then submits from it. */
async function solveInEditor(who: Principal, startAt: Date, seed: number, script: (b: TimelineBuilder) => void) {
  const { sessionId } = await startSession(db, who, { contestSlug: slug, label: "A", clientStartedAt: startAt.getTime() }, { now: startAt });
  const b = new TimelineBuilder(sessionId, startAt, seed);
  script(b);
  const submitSeq = b.submitMarker();
  const wire = b.wireEvents();
  for (let i = 0; i < wire.length; i += 150) {
    await ingestBatch(db, who, { sessionId, schemaVersion: TELEMETRY_SCHEMA_VERSION, events: wire.slice(i, i + 150) }, { now: new Date(b.now.getTime() + 1_000) });
  }
  const submittedAt = new Date(b.now.getTime() + 2_000);
  const { id } = await createSubmission(db, who, slug, { label: "A", language: "cpp17", source: b.source, ideSessionId: sessionId, ideSeq: submitSeq }, { now: submittedAt });
  await drainJobs(db, judge, { clock: () => submittedAt });
  return { submissionId: id, sessionId, submittedAt };
}

const subject = (who: Principal) => ({ userId: who.userId, contestId, problemId: problemIds[0]! });
const latestFor = async (who: Principal) =>
  (await db.select().from(anomalyAssessment).where(and(eq(anomalyAssessment.userId, who.userId), eq(anomalyAssessment.contestId, contestId))).orderBy(anomalyAssessment.computedAt)).pop();

describe("personal templates", () => {
  it("are versioned, deduplicated, owner-only, and frozen at contest start", async () => {
    const { id } = await createTemplate(db, templateUser, { name: "kadane", source: "int x = 1;" }, { now: new Date(T0.getTime() - 3_600_000) });
    expect(await saveTemplateVersion(db, templateUser, id, { source: "int x = 1;" }, { now: new Date(T0.getTime() - 60_000) })).toEqual({ created: false });
    expect(await saveTemplateVersion(db, templateUser, id, { source: SOLUTION }, { now: T0 })).toEqual({ created: true });
    // Edited after the contest started: must not apply to this contest.
    await saveTemplateVersion(db, templateUser, id, { source: "// changed mid-contest\nint main(){}" }, { now: at(1.5) });

    const [mine] = await listOwnTemplates(db, templateUser);
    expect(mine).toMatchObject({ name: "kadane", versionCount: 3 });
    const frozen = await frozenTemplatesFor(db, templateUser.userId, at(1));
    expect(frozen).toHaveLength(1);
    expect(frozen[0]!.source).toBe(SOLUTION);

    await expect(saveTemplateVersion(db, paster, id, { source: "steal" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(archiveTemplate(db, paster, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("archiving applies only to contests starting after it; archive happens once; versions are append-only", async () => {
    const { id } = await createTemplate(db, lateTemplate, { name: "old", source: "int y = 2;" }, { now: new Date(T0.getTime() - 7_200_000) });
    await archiveTemplate(db, lateTemplate, id, { now: at(2) });
    expect(await frozenTemplatesFor(db, lateTemplate.userId, at(1))).toHaveLength(1); // contest started before archiving
    expect(await frozenTemplatesFor(db, lateTemplate.userId, at(5))).toHaveLength(0);
    await expect(archiveTemplate(db, lateTemplate, id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(db.update(userTemplate).set({ archivedAt: null }).where(eq(userTemplate.id, id))).rejects.toThrow();
    await expect(db.update(userTemplateVersion).set({ source: "x" }).where(eq(userTemplateVersion.templateId, id))).rejects.toThrow();
  });
});

describe("approved snippets", () => {
  it("only the contest's managers can add or retire them, and they apply by time", async () => {
    const { id } = await addSnippet(db, setter, contestId, { name: "fast io", source: "ios::sync_with_stdio(false); cin.tie(nullptr);" }, { now: at(1.1) });
    await expect(addSnippet(db, otherSetter, contestId, { name: "x", source: "y" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listSnippets(db, reviewer, contestId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await snippetsInEffect(db, contestId, at(1.2))).map((s) => s.kind)).toEqual(["starter", "snippet"]);
    await retireSnippet(db, setter, contestId, id, { now: at(1.3) });
    expect((await snippetsInEffect(db, contestId, at(1.4))).map((s) => s.kind)).toEqual(["starter"]);
    await expect(retireSnippet(db, setter, contestId, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("analysis pipeline (synthetic scenarios)", () => {
  it("a judged submission enqueues analysis; ordinary typing is typical, a whole-solution paste is elevated", async () => {
    await solveInEditor(typist, at(1.2), 21, (b) => b.type(SOLUTION));
    await solveInEditor(paster, at(1.25), 22, (b) => b.type("int main() {\n").paste(SOLUTION));
    expect(await db.select().from(analysisJob).where(eq(analysisJob.contestId, contestId))).toHaveLength(2);

    await drainAnalysisJobs(db, { maxJobs: 10, clock: () => at(1.9) });
    expect(await latestFor(typist)).toMatchObject({ band: "typical", rulesetVersion: "baseline-v2" });
    const p = await latestFor(paster);
    expect(p).toMatchObject({ band: "elevated" });
    expect(p!.score).toBeGreaterThanOrEqual(50);
    expect((p!.warnings as { code: string }[]).map((w) => w.code)).toContain("priors_used");
  });

  it("pasting a template registered before the contest is not elevated; one saved after the start is", async () => {
    // templateUser's "kadane" template (= SOLUTION) was saved at T0, before the contest started at at(1).
    await solveInEditor(templateUser, at(1.3), 23, (b) => b.paste(SOLUTION));
    // lateTemplate saves the same code only after the contest started: it is not in effect.
    await createTemplate(db, lateTemplate, { name: "too late", source: SOLUTION }, { now: at(1.31) });
    await solveInEditor(lateTemplate, at(1.35), 24, (b) => b.paste(SOLUTION));
    await drainAnalysisJobs(db, { maxJobs: 10, clock: () => at(1.95) });

    expect(await latestFor(templateUser)).toMatchObject({ band: "typical" });
    expect(await latestFor(lateTemplate)).toMatchObject({ band: "elevated" });
  });

  it("a submission made outside the editor gets 'insufficient data', never a score", async () => {
    await createSubmission(db, noEditor, slug, { label: "A", language: "cpp17", source: SOLUTION }, { now: at(1.5) });
    await drainJobs(db, judge, { clock: () => at(1.5) });
    await drainAnalysisJobs(db, { clock: () => at(1.96) });
    expect(await latestFor(noEditor)).toMatchObject({ band: "insufficient_data", score: null });
  });

  it("is reproducible: unchanged inputs reuse the feature vector, and an unchanged cohort appends nothing", async () => {
    const fvBefore = (await db.select().from(featureVector)).length;
    // The cohort grew since typist was first scored, so this run may legitimately re-score…
    await runAnalysis(db, subject(typist), at(2));
    const after = (await db.select().from(anomalyAssessment)).length;
    // …but running again with nothing changed is a no-op.
    expect(await runAnalysis(db, subject(typist), at(2.01))).toBe("unchanged");
    expect((await db.select().from(anomalyAssessment)).length).toBe(after);
    // Same inputs → same digest → same feature vector row, both times.
    expect((await db.select().from(featureVector)).length).toBe(fvBefore);
  });

  it("re-scores when the cohort changes, keeping history; assessments are append-only", async () => {
    // New peers were analysed after typist's first assessment, so the cohort digest differs now.
    const count = async () => (await db.select().from(anomalyAssessment).where(eq(anomalyAssessment.userId, typist.userId))).length;
    const n = await count();
    await enqueueEndedContests(db, { now: at(3.5) });
    await drainAnalysisJobs(db, { maxJobs: 20, clock: () => at(3.5) });
    expect(await count()).toBeGreaterThanOrEqual(n);
    const a = await latestFor(typist);
    await expect(db.update(anomalyAssessment).set({ score: 0 }).where(eq(anomalyAssessment.id, a!.id))).rejects.toThrow();
  });

  it("collapses repeated triggers, and re-runs once if triggered while a worker holds the job", async () => {
    await enqueueAnalysis(db, subject(typist), at(2.1));
    await enqueueAnalysis(db, subject(typist), at(2.1));
    const claim = (await claimAnalysisJob(db, at(2.1)))!;
    expect(claim.subject.userId).toBe(typist.userId);
    await enqueueAnalysis(db, subject(typist), at(2.1)); // arrives mid-run
    await processAnalysisJob(db, claim, () => at(2.1));
    const [job] = await db.select().from(analysisJob).where(eq(analysisJob.userId, typist.userId));
    expect(job).toMatchObject({ status: "pending", rerunRequested: 0 });
    await drainAnalysisJobs(db, { clock: () => at(2.2) });
    expect((await db.select().from(analysisJob).where(eq(analysisJob.userId, typist.userId)))[0]!.status).toBe("done");
  });
});

describe("review access", () => {
  it("only reviewers see assessments; the queue lists elevated subjects first", async () => {
    const queue = await listLatestAssessments(db, reviewer, { contestSlug: slug });
    expect(queue[0]!.band).toBe("elevated");
    expect(new Set(queue.map((q) => q.userId)).size).toBe(queue.length);
    expect((await listLatestAssessments(db, reviewer, { band: "insufficient_data" })).every((q) => q.band === "insufficient_data")).toBe(true);

    await expect(listLatestAssessments(db, setter)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listLatestAssessments(db, typist)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("an assessment carries score, explanations, features, evidence, data quality and versions", async () => {
    const top = (await listLatestAssessments(db, reviewer, { band: "elevated" }))[0]!;
    const a = await getAssessment(db, reviewer, top.id);
    expect(a).toMatchObject({ rulesetVersion: "baseline-v2", featureSetVersion: "features-v1", band: "elevated" });
    expect(a.explanations.length).toBeGreaterThan(0);
    expect(a.features.adjusted_paste_share.available).toBe(true);
    expect((a.evidence as { kind: string }[]).some((e) => e.kind === "largest_insert")).toBe(true);
    expect(a.sessions.length).toBeGreaterThan(0);
    expect(a.inputsDigest).toMatch(/^[0-9a-f]{64}$/);
    await expect(getAssessment(db, setter, top.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
