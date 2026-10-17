import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/server/db";
import { judgeJob, submission } from "@/lib/server/db/schema";
import { MockJudge } from "@/lib/server/judge/mock";
import { drainJobs } from "@/lib/server/judge/worker";
import { createContest } from "@/lib/server/services/contests";
import type { Principal } from "@/lib/server/services/roles";
import {
  MAX_PENDING_PER_USER,
  SUBMIT_COOLDOWN_MS,
  createSubmission,
  getStandings,
  getSubmissionForViewer,
  listOwnSubmissions,
  sha256Hex,
} from "@/lib/server/services/submissions";
import { AC_SOURCE, CE_SOURCE, HIDDEN_INPUT_MARKER, at, runningContest, wa } from "../helpers/contest-fixture";
import { createTestDb } from "../helpers/db";
import { contestInput, principal } from "../helpers/fixtures";

let db: Db;
let close: () => Promise<void>;
let setter: Principal, otherSetter: Principal, reviewer: Principal, alice: Principal, bob: Principal, carol: Principal, outsider: Principal;
let slug: string;
const judge = new MockJudge(0);

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  [setter, otherSetter, reviewer, alice, bob, carol, outsider] = await Promise.all([
    principal(db, "problem_setter"),
    principal(db, "problem_setter"),
    principal(db, "reviewer"),
    principal(db),
    principal(db),
    principal(db),
    principal(db),
  ]);
  ({ slug } = await runningContest(db, setter, [alice, bob, carol]));
});
afterAll(async () => close());

const minutes = (m: number) => new Date(at(1).getTime() + m * 60_000);
const submitAs = (who: Principal, now: Date, source = AC_SOURCE, label = "A", kind: "submission" | "sample_run" = "submission") =>
  createSubmission(db, who, slug, { label, language: "cpp17", source, kind }, { now });

describe("submission rules", () => {
  it("requires a running, published contest and registration", async () => {
    await expect(submitAs(outsider, minutes(1))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(submitAs(alice, at(0.5))).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/not started/) });
    await expect(submitAs(alice, at(3))).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/ended/) });
    await expect(submitAs(alice, minutes(1), AC_SOURCE, "Z")).rejects.toMatchObject({ code: "NOT_FOUND" });

    const { id } = await createContest(db, setter, contestInput(at(1), at(3)));
    const draft = (await db.query.contest.findFirst({ where: (c, { eq }) => eq(c.id, id) }))!;
    await expect(createSubmission(db, alice, draft.slug, { label: "A", language: "cpp17", source: AC_SOURCE }, { now: minutes(1) })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("validates language, size and emptiness", async () => {
    await expect(createSubmission(db, alice, slug, { label: "A", language: "python3", source: "print(1)" }, { now: minutes(1) })).rejects.toBeInstanceOf(ZodError);
    await expect(createSubmission(db, alice, slug, { label: "A", language: "cpp17", source: "   \n" }, { now: minutes(1) })).rejects.toBeInstanceOf(ZodError);
    await expect(createSubmission(db, alice, slug, { label: "A", language: "cpp17", source: "x".repeat(64 * 1024 + 1) }, { now: minutes(1) })).rejects.toBeInstanceOf(ZodError);
  });

  it("stores the exact source bytes with a matching SHA-256 and creates a job atomically", async () => {
    const source = "int main() {}   \r\n\r\n// trailing\t\n";
    const { id } = await submitAs(alice, minutes(2), source);
    const [row] = await db.select().from(submission).where(eq(submission.id, id));
    expect(row!.source).toBe(source);
    expect(row!.sourceSha256).toBe(sha256Hex(source));
    expect(await db.select().from(judgeJob).where(eq(judgeJob.submissionId, id))).toHaveLength(1);
  });

  it("throttles rapid submissions and caps pending ones per user", async () => {
    await submitAs(bob, minutes(10));
    await expect(submitAs(bob, new Date(minutes(10).getTime() + SUBMIT_COOLDOWN_MS - 1))).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    // Bob now has 1 pending; fill up to the cap.
    for (let i = 1; i < MAX_PENDING_PER_USER; i++) await submitAs(bob, new Date(minutes(10).getTime() + i * SUBMIT_COOLDOWN_MS));
    await expect(submitAs(bob, minutes(11))).rejects.toMatchObject({ code: "RATE_LIMITED", message: expect.stringMatching(/pending/) });
    await drainJobs(db, judge, { maxJobs: 50, clock: () => minutes(11) });
    await expect(submitAs(bob, minutes(12))).resolves.toHaveProperty("id");
  });
});

describe("snapshot immutability (database-enforced)", () => {
  it("rejects edits to submitted columns and deletions, but allows result updates", async () => {
    const { id } = await submitAs(carol, minutes(20));
    const rejected = (err: unknown) => err instanceof Error && /immutable/.test(String((err.cause as Error | undefined)?.message));
    await expect(db.update(submission).set({ source: "int main(){ /* edited */ }" }).where(eq(submission.id, id))).rejects.toSatisfy(rejected);
    await expect(db.update(submission).set({ createdAt: minutes(0) }).where(eq(submission.id, id))).rejects.toSatisfy(rejected);
    await expect(db.delete(submission).where(eq(submission.id, id))).rejects.toSatisfy(rejected);
    await expect(db.update(submission).set({ status: "running" }).where(eq(submission.id, id))).resolves.toBeDefined();
  });

  it("rejects a row whose hash does not match its source", async () => {
    const [existing] = await db.select().from(submission).limit(1);
    await expect(
      db.insert(submission).values({ ...existing!, id: undefined, source: "int main(){}", sourceSha256: sha256Hex("something else") }),
    ).rejects.toThrow();
  });
});

describe("viewing submissions", () => {
  it("owners, contest managers and reviewers can view; other users get 404", async () => {
    const { id } = await submitAs(alice, minutes(30), wa(2));
    await drainJobs(db, judge, { clock: () => minutes(30) });

    const own = await getSubmissionForViewer(db, alice, id);
    expect(own).toMatchObject({ verdict: "wrong_answer", failedTest: 2, isOwner: true, label: "A" });
    expect(own.source).toContain("@mock-verdict");
    await expect(getSubmissionForViewer(db, setter, id)).resolves.toMatchObject({ isOwner: false });
    await expect(getSubmissionForViewer(db, reviewer, id)).resolves.toMatchObject({ id });

    await expect(getSubmissionForViewer(db, bob, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getSubmissionForViewer(db, otherSetter, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getSubmissionForViewer(db, alice, "not-a-uuid")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("never exposes hidden test data to the contestant", async () => {
    const { id } = await submitAs(alice, minutes(31), CE_SOURCE);
    await drainJobs(db, judge, { clock: () => minutes(31) });
    const view = await getSubmissionForViewer(db, alice, id);
    expect(JSON.stringify(view)).not.toContain(HIDDEN_INPUT_MARKER);
    const list = await listOwnSubmissions(db, alice, slug);
    expect(JSON.stringify(list)).not.toContain(HIDDEN_INPUT_MARKER);
  });

  it("lists only the viewer's own submissions, without source", async () => {
    const list = await listOwnSubmissions(db, alice, slug);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((s) => !("source" in s))).toBe(true);
    const bobs = await listOwnSubmissions(db, bob, slug);
    const aliceIds = new Set(list.map((s) => s.id));
    expect(bobs.some((s) => aliceIds.has(s.id))).toBe(false);
    expect((await listOwnSubmissions(db, alice, slug, { label: "b" })).every((s) => s.label === "B")).toBe(true);
  });
});

describe("standings", () => {
  it("ranks by solved count then ICPC penalty; CE and sample runs cost nothing; ties share a rank", async () => {
    const db2 = await createTestDb();
    try {
      const s = await principal(db2.db, "problem_setter");
      const [x, y, z, w] = await Promise.all([principal(db2.db), principal(db2.db), principal(db2.db), principal(db2.db)]);
      const c = await runningContest(db2.db, s, [x!, y!, z!, w!]);
      const sub = async (who: Principal, m: number, source: string, label = "A", kind: "submission" | "sample_run" = "submission") => {
        await createSubmission(db2.db, who, c.slug, { label, language: "cpp17", source, kind }, { now: minutes(m) });
        await drainJobs(db2.db, judge, { clock: () => minutes(m) });
      };
      // x: A after one WA (10 + 20 = 30), B at 40 → 2 solved, 70 penalty
      await sub(x!, 5, wa());
      await sub(x!, 10, AC_SOURCE);
      await sub(x!, 40, AC_SOURCE, "B");
      await sub(x!, 50, wa(), "A"); // after AC: ignored
      // y: CE (no penalty), sample-run WA (ignored), A at 30 → 1 solved, 30 penalty
      await sub(y!, 3, CE_SOURCE);
      await sub(y!, 4, wa(), "A", "sample_run");
      await sub(y!, 30, AC_SOURCE);
      // z: identical to y's result → tied rank
      await sub(z!, 30, AC_SOURCE);
      // w: only a WA → 0 solved, but listed

      const { rows, contest } = await getStandings(db2.db, null, c.slug, { now: at(2.5) });
      expect(contest.labels).toEqual(["A", "B"]);
      const byUser = Object.fromEntries(rows.map((r) => [r.userId, { rank: r.rank, solved: r.solved, penalty: r.penalty }]));
      expect(byUser[x!.userId]).toEqual({ rank: 1, solved: 2, penalty: 70 });
      expect(byUser[y!.userId]).toEqual({ rank: 2, solved: 1, penalty: 30 });
      expect(byUser[z!.userId]).toEqual({ rank: 2, solved: 1, penalty: 30 });
      expect(byUser[w!.userId]).toEqual({ rank: 4, solved: 0, penalty: 0 });
      expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
      const xRow = rows.find((r) => r.userId === x!.userId)!;
      expect(xRow.cells.A).toMatchObject({ solved: true, rejected: 1, solvedAtMinute: 10 });
      expect(rows.find((r) => r.userId === y!.userId)!.cells.A).toMatchObject({ rejected: 0, solvedAtMinute: 30 });

      // Upcoming contests have no standings yet.
      expect((await getStandings(db2.db, null, c.slug, { now: at(0.5) })).rows).toEqual([]);
    } finally {
      await db2.close();
    }
  });
});
