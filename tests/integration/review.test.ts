import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/server/db";
import { auditLog, contestantResponse, decisionConfirmation, reviewCase, reviewDecision } from "@/lib/server/db/schema";
import { drainAnalysisJobs } from "@/lib/server/integrity/pipeline";
import { MockJudge } from "@/lib/server/judge/mock";
import { drainJobs } from "@/lib/server/judge/worker";
import {
  addNote,
  confirmDecision,
  getCase,
  getContestantNotices,
  listCases,
  openCaseManually,
  recordDecision,
  reopenCase,
  submitResponse,
  violationsInEffect,
} from "@/lib/server/review/cases";
import { listLatestAssessments } from "@/lib/server/integrity/review";
import type { Principal } from "@/lib/server/services/roles";
import { createSubmission, getStandings } from "@/lib/server/services/submissions";
import { ingestBatch, startSession } from "@/lib/server/telemetry/ingest";
import { TELEMETRY_SCHEMA_VERSION } from "@/lib/telemetry/events";
import { at, runningContest } from "../helpers/contest-fixture";
import { createTestDb } from "../helpers/db";
import { principal } from "../helpers/fixtures";
import { SOLUTION, TimelineBuilder } from "../helpers/timeline";

let db: Db;
let close: () => Promise<void>;
let setter: Principal, reviewer: Principal, reviewer2: Principal, admin: Principal, admin2: Principal, paster: Principal, typist: Principal, other: Principal;
let contestId: string, slug: string;
const judge = new MockJudge(0);
const RATIONALE = "The whole solution was inserted in one paste 20 s after the editor lost focus, with no matching template.";

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  [setter, reviewer, reviewer2, admin, admin2, paster, typist, other] = await Promise.all([
    principal(db, "problem_setter"),
    principal(db, "reviewer"),
    principal(db, "reviewer"),
    principal(db, "admin"),
    principal(db, "admin"),
    principal(db),
    principal(db),
    principal(db),
  ]);
  ({ id: contestId, slug } = await runningContest(db, setter, [paster, typist, other]));

  const play = async (who: Principal, startAt: Date, seed: number, script: (b: TimelineBuilder) => void) => {
    const { sessionId } = await startSession(db, who, { contestSlug: slug, label: "A", clientStartedAt: startAt.getTime() }, { now: startAt });
    const b = new TimelineBuilder(sessionId, startAt, seed);
    script(b);
    const seq = b.submitMarker();
    const wire = b.wireEvents();
    for (let i = 0; i < wire.length; i += 150) await ingestBatch(db, who, { sessionId, schemaVersion: TELEMETRY_SCHEMA_VERSION, events: wire.slice(i, i + 150) }, { now: b.now });
    const when = new Date(b.now.getTime() + 2_000);
    await createSubmission(db, who, slug, { label: "A", language: "cpp17", source: b.source, ideSessionId: sessionId, ideSeq: seq }, { now: when });
    await drainJobs(db, judge, { clock: () => when });
  };
  await play(paster, at(1.2), 31, (b) => b.type("int main() {\n").paste(SOLUTION));
  await play(typist, at(1.25), 32, (b) => b.type(SOLUTION));
  await drainAnalysisJobs(db, { maxJobs: 10, clock: () => at(1.9) });
});
afterAll(async () => close());

const caseOf = async (who: Principal) => (await db.select().from(reviewCase).where(and(eq(reviewCase.userId, who.userId), eq(reviewCase.contestId, contestId))))[0];

describe("case opening", () => {
  it("an elevated assessment opens exactly one case; a typical one opens none", async () => {
    expect(await caseOf(paster)).toMatchObject({ status: "open", openedReason: "elevated_assessment", openedBy: null });
    expect(await caseOf(typist)).toBeUndefined();
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "review.case.open"));
    expect(audits).toHaveLength(1);
  });

  it("a reviewer can open a case manually; doing it twice returns the same case", async () => {
    const [a] = await listLatestAssessments(db, reviewer, { contestSlug: slug, band: "typical" });
    const first = await openCaseManually(db, reviewer, a!.id);
    expect(first.created).toBe(true);
    expect(await openCaseManually(db, reviewer2, a!.id)).toEqual({ id: first.id, created: false });
    await expect(openCaseManually(db, typist, a!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("access boundaries", () => {
  it("contestants and problem setters cannot use any review operation", async () => {
    const c = (await caseOf(paster))!;
    for (const who of [paster, typist, setter]) {
      await expect(listCases(db, who)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(getCase(db, who, c.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(addNote(db, who, c.id, "x")).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(recordDecision(db, who, c.id, { outcome: "no_concern", rationale: RATIONALE })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("the queue lists active, elevated cases first with neutral data and conflict flags", async () => {
    const { items, total } = await listCases(db, reviewer, { contestSlug: slug });
    expect(total).toBe(2);
    expect(items[0]).toMatchObject({ userId: paster.userId, band: "elevated", status: "open", conflictOfInterest: false });
    expect((await listCases(db, reviewer, { band: "typical" })).items.every((i) => i.band === "typical")).toBe(true);
    expect((await listCases(db, reviewer, { contestant: "zzz-nobody" })).total).toBe(0);
  });

  it("separation of duties: nobody acts on a case in a contest they created or about themselves", async () => {
    const owner = await principal(db, "admin");
    const subjectUser = await principal(db);
    const own = await runningContest(db, owner, [subjectUser]);
    const [inOwnContest] = await db.insert(reviewCase).values({ userId: subjectUser.userId, contestId: own.id, problemId: own.problemIds[0]!, openedReason: "manual" }).returning();
    // A reviewer who also competed: a case about their own work.
    const [aboutSelf] = await db.insert(reviewCase).values({ userId: reviewer2.userId, contestId: own.id, problemId: own.problemIds[0]!, openedReason: "manual" }).returning();

    for (const [who, c] of [[owner, inOwnContest!], [reviewer2, aboutSelf!]] as const) {
      const detail = await getCase(db, who, c.id);
      expect(detail.permissions).toMatchObject({ conflictOfInterest: true, canDecide: false, canNote: false });
      await expect(recordDecision(db, who, c.id, { outcome: "no_concern", rationale: RATIONALE })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(addNote(db, who, c.id, "note")).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    // An uninvolved reviewer is fine.
    expect((await getCase(db, reviewer, inOwnContest!.id)).permissions.conflictOfInterest).toBe(false);
    expect((await listCases(db, owner, { contestSlug: own.slug })).items.every((i) => i.conflictOfInterest)).toBe(true);
  });
});

describe("decisions and the two-person rule", () => {
  it("validates rationale length and records views and notes in the audit log", async () => {
    const c = (await caseOf(paster))!;
    await expect(recordDecision(db, reviewer, c.id, { outcome: "confirmed_violation", rationale: "too short" })).rejects.toBeInstanceOf(ZodError);
    const detail = await getCase(db, reviewer, c.id);
    expect(detail.permissions).toMatchObject({ canDecide: true, canConfirm: false });
    expect(detail.latestAssessmentId).toBeTruthy();
    await addNote(db, reviewer, c.id, "Looking at the paste at seq 15.");
    const actions = (await db.select().from(auditLog).where(eq(auditLog.targetId, c.id))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["review.case.open", "review.case.view", "review.note.add"]));
  });

  it("a confirmed violation does not take effect until a different admin confirms it", async () => {
    const c = (await caseOf(paster))!;
    const detail = await getCase(db, reviewer, c.id);
    const { status } = await recordDecision(db, reviewer, c.id, { outcome: "confirmed_violation", rationale: RATIONALE, assessmentId: detail.latestAssessmentId });
    expect(status).toBe("awaiting_confirmation");
    expect((await violationsInEffect(db, contestId)).size).toBe(0);
    expect(await getContestantNotices(db, paster, contestId)).toEqual([]);

    // Not a reviewer-level permission, and never the author.
    await expect(confirmDecision(db, reviewer2, c.id, { verdict: "confirmed", rationale: "agree with the evidence" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordDecision(db, reviewer2, c.id, { outcome: "no_concern", rationale: RATIONALE })).rejects.toMatchObject({ code: "CONFLICT" });

    const { status: after } = await confirmDecision(db, admin, c.id, { verdict: "confirmed", rationale: "Evidence reviewed; agree." });
    expect(after).toBe("closed");
    expect((await violationsInEffect(db, contestId)).has(`${paster.userId}|${c.problemId}`)).toBe(true);
  });

  it("the author of a violation decision can never confirm it, even as an admin (service and database)", async () => {
    const c = (await caseOf(typist))!;
    await recordDecision(db, admin2, c.id, { outcome: "confirmed_violation", rationale: RATIONALE });
    await expect(confirmDecision(db, admin2, c.id, { verdict: "confirmed", rationale: "self approval attempt" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [d] = await db.select().from(reviewDecision).where(eq(reviewDecision.caseId, c.id));
    await expect(db.insert(decisionConfirmation).values({ decisionId: d!.id, adminId: admin2.userId, verdict: "confirmed", rationale: "bypassing the service" })).rejects.toThrow();
    // A different admin rejects it: back to review, nothing takes effect.
    const { status } = await confirmDecision(db, admin, c.id, { verdict: "rejected", rationale: "Typing rhythm looks human; no evidence." });
    expect(status).toBe("open");
    expect((await violationsInEffect(db, contestId)).has(`${typist.userId}|${c.problemId}`)).toBe(false);
    await recordDecision(db, reviewer, c.id, { outcome: "no_concern", rationale: "Ordinary typing throughout; flagged only because a reviewer opened it manually." });
    expect((await caseOf(typist))!.status).toBe("closed");
  });

  it("decisions and confirmations are append-only", async () => {
    const [d] = await db.select().from(reviewDecision).limit(1);
    await expect(db.update(reviewDecision).set({ rationale: "x".repeat(40) }).where(eq(reviewDecision.id, d!.id))).rejects.toThrow();
    await expect(db.delete(reviewDecision).where(eq(reviewDecision.id, d!.id))).rejects.toThrow();
    const [k] = await db.select().from(decisionConfirmation).limit(1);
    await expect(db.update(decisionConfirmation).set({ verdict: "rejected" }).where(eq(decisionConfirmation.id, k!.id))).rejects.toThrow();
  });
});

describe("effects and contestant notice", () => {
  it("the confirmed problem is excluded from standings and marked", async () => {
    const { rows } = await getStandings(db, null, slug, { now: at(2.5) });
    const p = rows.find((r) => r.userId === paster.userId)!;
    expect(p.hasExclusion).toBe(true);
    expect(p.cells.A).toMatchObject({ excluded: true, solved: false });
    expect(p.solved).toBe(0);
    const t = rows.find((r) => r.userId === typist.userId)!;
    expect(t.cells.A).toMatchObject({ solved: true, excluded: false });
  });

  it("the contestant sees a neutral notice with the rationale and can respond; others cannot", async () => {
    const notices = await getContestantNotices(db, paster, contestId);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ label: "A", rationale: RATIONALE, inEffect: true, responses: [] });
    expect(JSON.stringify(notices)).not.toContain(reviewer.userId);
    expect(await getContestantNotices(db, typist, contestId)).toEqual([]);

    await submitResponse(db, paster, notices[0]!.caseId, "I pasted from my own local file written before the contest.");
    await expect(submitResponse(db, other, notices[0]!.caseId, "not mine")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(contestantResponse)).toHaveLength(1);
    // Reviewers see the response on the case.
    expect((await getCase(db, reviewer, notices[0]!.caseId)).responses).toHaveLength(1);
  });

  it("reopening and deciding 'no concern' reverses the effect; history is kept", async () => {
    const c = (await caseOf(paster))!;
    await expect(recordDecision(db, reviewer, c.id, { outcome: "no_concern", rationale: RATIONALE })).rejects.toMatchObject({ code: "CONFLICT" });
    await reopenCase(db, reviewer2, c.id, "Contestant response describes a personal file; re-checking.");
    await recordDecision(db, reviewer2, c.id, { outcome: "no_concern", rationale: "Contestant showed the file existed before the contest; reversing the earlier decision." });
    expect((await violationsInEffect(db, contestId)).size).toBe(0);
    const { rows } = await getStandings(db, null, slug, { now: at(2.5) });
    expect(rows.find((r) => r.userId === paster.userId)!.cells.A).toMatchObject({ excluded: false, solved: true });
    const notices = await getContestantNotices(db, paster, contestId);
    expect(notices[0]).toMatchObject({ inEffect: false });
    const decisions = await db.select().from(reviewDecision).where(eq(reviewDecision.caseId, c.id));
    expect(decisions).toHaveLength(2);
    expect(decisions[1]!.supersedesId).toBe(decisions[0]!.id);
  });
});
