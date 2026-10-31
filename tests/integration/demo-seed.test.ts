import { and, desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CAST, DEMO_CONTEST_SLUG, seedIntegrityDemo, type DemoActors } from "@/eval/demo";
import type { Db } from "@/lib/server/db";
import { anomalyAssessment, contestantResponse, featureVector, reviewCase, submission, telemetryEvent } from "@/lib/server/db/schema";
import { listLatestAssessments } from "@/lib/server/integrity/review";
import { getContestantNotices } from "@/lib/server/review/cases";
import { getStandings } from "@/lib/server/services/submissions";
import { createTestDb } from "../helpers/db";
import { principal } from "../helpers/fixtures";

let db: Db;
let close: () => Promise<void>;
let actors: DemoActors;
let contestId: string;
const NOW = new Date("2030-03-01T12:00:00Z");

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  actors = {
    setter: await principal(db, "problem_setter"),
    reviewer: await principal(db, "reviewer"),
    admin: await principal(db, "admin"),
    contestants: await Promise.all(CAST.map(() => principal(db))),
  };
  const result = await seedIntegrityDemo(db, actors, { now: NOW });
  expect(result.created).toBe(true);
  contestId = result.contestId;
}, 180_000);
afterAll(async () => close());

const caseOf = async (i: number) => (await db.select().from(reviewCase).where(and(eq(reviewCase.userId, actors.contestants[i]!.userId), eq(reviewCase.contestId, contestId))))[0];

describe("integrity demo seed (synthetic)", () => {
  it("plays every contestant through telemetry, judging and scoring", async () => {
    const subs = await db.select().from(submission).where(eq(submission.contestId, contestId));
    expect(subs.every((s) => s.status === "judged" && s.judgeProvider === "mock")).toBe(true);
    const finals = subs.filter((s) => s.kind === "submission" && s.verdict === "accepted");
    expect(finals).toHaveLength(CAST.length * 2);
    expect(finals.every((s) => s.ideSessionId && s.ideSeq != null)).toBe(true);
    expect((await db.select({ seq: telemetryEvent.seq }).from(telemetryEvent)).length).toBeGreaterThan(5_000);

    const assessments = await listLatestAssessments(db, actors.reviewer, { contestSlug: DEMO_CONTEST_SLUG });
    expect(assessments).toHaveLength(CAST.length * 2);
    expect(assessments.filter((a) => a.band === "elevated").length).toBeGreaterThan(0);
    expect(assessments.filter((a) => a.band === "typical").length).toBeGreaterThan(CAST.length);
  });

  it("looks like real client traffic, and the post-contest re-score uses the cohort", async () => {
    // Telemetry arrives in flush-sized batches shortly after it happens: no clock-skew artefacts.
    const vectors = await db.select({ dq: featureVector.dataQuality }).from(featureVector).where(eq(featureVector.contestId, contestId));
    expect(JSON.stringify(vectors.map((v) => v.dq))).not.toContain("clock_skew");
    // Every subject's latest assessment was scored with the full cohort for at least some signals.
    const rows = await db
      .selectDistinctOn([anomalyAssessment.userId, anomalyAssessment.problemId], { mode: sql<string>`${anomalyAssessment.reference}->>'mode'` })
      .from(anomalyAssessment)
      .where(eq(anomalyAssessment.contestId, contestId))
      .orderBy(anomalyAssessment.userId, anomalyAssessment.problemId, desc(anomalyAssessment.computedAt));
    expect(rows).toHaveLength(CAST.length * 2);
    expect(rows.filter((r) => r.mode === "priors")).toHaveLength(0);
  });

  it("stages the four review states the demo walks through", async () => {
    expect(await caseOf(7)).toMatchObject({ status: "closed" }); // inconclusive
    expect(await caseOf(8)).toMatchObject({ status: "closed" }); // confirmed by a second person
    expect(await caseOf(9)).toMatchObject({ status: "awaiting_confirmation" });
    expect(await caseOf(10)).toMatchObject({ status: "open" });
    const pasted = (await caseOf(8))!;
    expect(await db.select().from(contestantResponse).where(eq(contestantResponse.caseId, pasted.id))).toHaveLength(1);
  });

  it("only the two-person-confirmed violation reaches standings and the contestant's notice", async () => {
    const standings = await getStandings(db, null, DEMO_CONTEST_SLUG, { now: NOW });
    const excluded = standings.rows.filter((r) => Object.values(r.cells).some((c) => c.excluded));
    expect(excluded.map((r) => r.userId)).toEqual([actors.contestants[8]!.userId]);
    expect(await getContestantNotices(db, actors.contestants[8]!, contestId)).toHaveLength(1);
    expect(await getContestantNotices(db, actors.contestants[9]!, contestId)).toHaveLength(0);
  });

  it("is idempotent: a second run leaves the contest untouched", async () => {
    const before = (await db.select({ id: submission.id }).from(submission)).length;
    expect(await seedIntegrityDemo(db, actors, { now: NOW })).toMatchObject({ contestId, created: false });
    expect((await db.select({ id: submission.id }).from(submission)).length).toBe(before);
  });
});
