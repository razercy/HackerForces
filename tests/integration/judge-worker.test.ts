import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/server/db";
import { judgeJob, submission } from "@/lib/server/db/schema";
import { MockJudge } from "@/lib/server/judge/mock";
import type { JudgeProvider, JudgeRequest } from "@/lib/server/judge/types";
import { JudgeUnavailableError } from "@/lib/server/judge/types";
import { LEASE_MS, MAX_ATTEMPTS, claimNextJob, drainJobs, hasClaimableJob, processJob } from "@/lib/server/judge/worker";
import type { Principal } from "@/lib/server/services/roles";
import { createSubmission } from "@/lib/server/services/submissions";
import { AC_SOURCE, CE_SOURCE, HIDDEN_INPUT_MARKER, at, runningContest, wa } from "../helpers/contest-fixture";
import { createTestDb } from "../helpers/db";
import { principal } from "../helpers/fixtures";

let db: Db;
let close: () => Promise<void>;
let setter: Principal;
let contestants: Principal[];
let slug: string;
const judge = new MockJudge(0);

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  setter = await principal(db, "problem_setter");
  contestants = await Promise.all(Array.from({ length: 8 }, () => principal(db)));
  ({ slug } = await runningContest(db, setter, contestants));
});
afterAll(async () => close());

// Each test drains whatever earlier tests left behind so claims are predictable.
beforeEach(async () => {
  await drainJobs(db, judge, { maxJobs: 100, clock: () => at(2.9) });
});

let userIdx = 0;
let minute = 0;
/** Submit as a fresh contestant at a fresh time, avoiding the per-user cooldown. */
async function submit(source: string, kind: "submission" | "sample_run" = "submission") {
  const who = contestants[userIdx++ % contestants.length]!;
  const now = new Date(at(1).getTime() + ++minute * 60_000);
  const { id } = await createSubmission(db, who, slug, { label: "A", language: "cpp17", source, kind }, { now });
  return { id, now };
}
const getSub = async (id: string) => (await db.select().from(submission).where(eq(submission.id, id)))[0]!;
const getJob = async (id: string) => (await db.select().from(judgeJob).where(eq(judgeJob.submissionId, id)))[0]!;

describe("judge worker", () => {
  it("claims a job, marks the submission running, then records an accepted verdict", async () => {
    const { id, now } = await submit(AC_SOURCE);
    expect((await getSub(id)).status).toBe("queued");

    const claim = await claimNextJob(db, now);
    expect(claim).toMatchObject({ submissionId: id, attempt: 1 });
    expect((await getSub(id)).status).toBe("running");

    expect(await processJob(db, judge, claim!, () => now)).toBe("judged");
    const s = await getSub(id);
    expect(s).toMatchObject({ status: "judged", verdict: "accepted", passedTests: 3, totalTests: 3, failedTest: null, judgeProvider: "mock" });
    expect((await getJob(id)).status).toBe("done");
    expect(await claimNextJob(db, now)).toBeNull();
  });

  it("judges sample runs against the public examples only", async () => {
    let seen: JudgeRequest | undefined;
    const spy: JudgeProvider = { name: "spy", judge: async (req, o) => ((seen = req), judge.judge(req, o)) };
    const { id, now } = await submit(AC_SOURCE, "sample_run");
    await drainJobs(db, spy, { clock: () => now });
    expect(seen?.tests).toEqual([{ ordinal: 1, input: "1 2\n", expectedOutput: "3\n" }]);
    expect(JSON.stringify(seen)).not.toContain(HIDDEN_INPUT_MARKER);
    expect(await getSub(id)).toMatchObject({ verdict: "accepted", totalTests: 1 });
  });

  it("sends hidden tests (to the judge only) for real submissions, and records the failing ordinal", async () => {
    let seen: JudgeRequest | undefined;
    const spy: JudgeProvider = { name: "spy", judge: async (req, o) => ((seen = req), judge.judge(req, o)) };
    const { id, now } = await submit(wa(2));
    await drainJobs(db, spy, { clock: () => now });
    expect(seen?.tests.map((t) => t.ordinal)).toEqual([1, 2, 3]);
    expect(await getSub(id)).toMatchObject({ verdict: "wrong_answer", failedTest: 2, passedTests: 1 });
  });

  it("records compilation errors with diagnostics and no runtime stats", async () => {
    const { id, now } = await submit(CE_SOURCE);
    await drainJobs(db, judge, { clock: () => now });
    const s = await getSub(id);
    expect(s).toMatchObject({ verdict: "compilation_error", timeMs: null, memoryKb: null });
    expect(s.compileOutput).toMatch(/undefined reference to `main'/);
  });

  it("retries infrastructure failures with backoff, then marks the submission failed", async () => {
    const { id, now } = await submit("// @mock-verdict judge_unavailable\nint main(){}");
    let t = now;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const claim = await claimNextJob(db, t);
      expect(claim?.attempt).toBe(attempt);
      expect(await processJob(db, judge, claim!, () => t)).toBe("retry");
      const job = await getJob(id);
      if (attempt < MAX_ATTEMPTS) {
        expect(job.status).toBe("pending");
        expect((await getSub(id)).status).toBe("queued");
        // Backoff: not claimable immediately.
        expect(await hasClaimableJob(db, id, t)).toBe(false);
        t = new Date(job.availableAt.getTime() + 1);
        expect(await hasClaimableJob(db, id, t)).toBe(true);
      }
    }
    expect(await getJob(id)).toMatchObject({ status: "dead", lastError: expect.stringContaining("JudgeUnavailableError") });
    expect(await getSub(id)).toMatchObject({ status: "failed", verdict: null });
  });

  it("re-claims a job whose lease expired, and fences off the stale worker's result", async () => {
    const { id, now } = await submit(AC_SOURCE);
    const stale = (await claimNextJob(db, now))!;
    expect(await claimNextJob(db, new Date(now.getTime() + LEASE_MS - 1))).toBeNull();

    const later = new Date(now.getTime() + LEASE_MS + 1);
    const fresh = (await claimNextJob(db, later))!;
    expect(fresh).toMatchObject({ jobId: stale.jobId, attempt: 2 });

    // The stale worker finishes late with a different verdict: it must not be recorded.
    const liar: JudgeProvider = { name: "stale", judge: async () => ({ verdict: "wrong_answer", timeMs: 1, memoryKb: 1, passedTests: 0, totalTests: 3, failedTest: 1, compileOutput: null }) };
    expect(await processJob(db, liar, stale, () => later)).toBe("lost_lease");
    expect((await getSub(id)).verdict).toBeNull();

    expect(await processJob(db, judge, fresh, () => later)).toBe("judged");
    expect(await getSub(id)).toMatchObject({ verdict: "accepted", judgeProvider: "mock" });
  });

  it("marks a job dead when its final attempt's lease expires", async () => {
    const { id, now } = await submit(AC_SOURCE);
    let t = now;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(await claimNextJob(db, t)).not.toBeNull();
      t = new Date(t.getTime() + LEASE_MS + 1);
    }
    expect(await claimNextJob(db, t)).toBeNull();
    expect((await getJob(id)).status).toBe("dead");
    expect((await getSub(id)).status).toBe("failed");
  });

  it("hands each job to exactly one of several concurrent claimers", async () => {
    const { id, now } = await submit(AC_SOURCE);
    const claims = await Promise.all([claimNextJob(db, now), claimNextJob(db, now), claimNextJob(db, now)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.submissionId).toBe(id);
  });

  it("drains multiple queued jobs within the job budget", async () => {
    const ids = [(await submit(AC_SOURCE)).id, (await submit(wa())).id, (await submit(AC_SOURCE)).id];
    const { processed } = await drainJobs(db, judge, { maxJobs: 2, clock: () => at(2.5) });
    expect(processed).toBe(2);
    await drainJobs(db, judge, { clock: () => at(2.5) });
    for (const id of ids) expect((await getSub(id)).status).toBe("judged");
  });

  it("an unexpected judge exception is retried rather than crashing the drain", async () => {
    const boom: JudgeProvider = { name: "boom", judge: async () => { throw new JudgeUnavailableError("down"); } };
    const { id, now } = await submit(AC_SOURCE);
    const original = console.error;
    console.error = () => {};
    try {
      await expect(drainJobs(db, boom, { clock: () => now })).resolves.toEqual({ processed: 1 });
    } finally {
      console.error = original;
    }
    expect((await getSub(id)).status).toBe("queued");
  });
});
