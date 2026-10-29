import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "@/lib/server/auth/create-auth";
import type { Db } from "@/lib/server/db";
import { auditLog, judgeJob, rateLimit, submission } from "@/lib/server/db/schema";
import { JudgeUnavailableError, type JudgeProvider } from "@/lib/server/judge/types";
import { claimNextJob, drainJobs, processJob, MAX_ATTEMPTS } from "@/lib/server/judge/worker";
import { assertSameOrigin } from "@/lib/server/origin";
import { judgeStatus, queueHealth, requeueDeadJudgeJob } from "@/lib/server/services/ops";
import type { Principal } from "@/lib/server/services/roles";
import { createSubmission } from "@/lib/server/services/submissions";
import { MockJudge } from "@/lib/server/judge/mock";
import { AC_SOURCE, at, runningContest } from "../helpers/contest-fixture";
import { createTestDb } from "../helpers/db";
import { principal } from "../helpers/fixtures";

let db: Db;
let close: () => Promise<void>;
let admin: Principal, reviewer: Principal, setter: Principal, alice: Principal;
let slug: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  [admin, reviewer, setter, alice] = await Promise.all([principal(db, "admin"), principal(db, "reviewer"), principal(db, "problem_setter"), principal(db)]);
  ({ slug } = await runningContest(db, setter, [alice]));
});
afterAll(async () => close());

describe("same-origin check for JSON routes", () => {
  const origin = "https://hackerforces.example";
  const req = (headers: Record<string, string>) => new Request(`${origin}/api/x`, { method: "POST", headers });
  it("accepts the app's own origin", () => {
    expect(() => assertSameOrigin(req({ origin }), origin)).not.toThrow();
  });
  it("rejects other origins and requests without an Origin header", () => {
    expect(() => assertSameOrigin(req({ origin: "https://evil.example" }), origin)).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() => assertSameOrigin(req({ origin: "https://hackerforces.example.evil.example" }), origin)).toThrow();
    expect(() => assertSameOrigin(req({}), origin)).toThrow();
  });
});

describe("operations", () => {
  const down: JudgeProvider = { name: "down", judge: async () => { throw new JudgeUnavailableError("down"); } };

  it("only admins see queue health; a dead job can be requeued, and that is audited", async () => {
    await expect(queueHealth(db, reviewer)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { id } = await createSubmission(db, alice, slug, { label: "A", language: "cpp17", source: AC_SOURCE }, { now: at(1.5) });
    // Exhaust retries with an unavailable judge.
    const original = console.error;
    console.error = () => {};
    let t = at(1.5);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const c = (await claimNextJob(db, t))!;
      await processJob(db, down, c, () => t);
      t = new Date(t.getTime() + 3_600_000);
    }
    console.error = original;
    const health = await queueHealth(db, admin);
    expect(health.judge.byStatus.dead).toBe(1);
    expect(health.judge.dead[0]!.lastError).toContain("JudgeUnavailableError");
    expect((await db.select().from(submission).where(eq(submission.id, id)))[0]!.status).toBe("failed");

    await expect(requeueDeadJudgeJob(db, reviewer, health.judge.dead[0]!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await requeueDeadJudgeJob(db, admin, health.judge.dead[0]!.id, { now: at(2) });
    expect((await db.select().from(submission).where(eq(submission.id, id)))[0]!.status).toBe("queued");
    await drainJobs(db, new MockJudge(0), { clock: () => at(2) });
    expect((await db.select().from(submission).where(eq(submission.id, id)))[0]!).toMatchObject({ status: "judged", verdict: "accepted" });
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "ops.judge_job.requeue")))).toHaveLength(1);
    // Only dead jobs can be requeued.
    const [done] = await db.select().from(judgeJob).where(eq(judgeJob.submissionId, id));
    await expect(requeueDeadJudgeJob(db, admin, done!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports judge reachability without exposing configuration", async () => {
    expect(await judgeStatus(new MockJudge(0))).toEqual({ provider: "mock", reachable: null });
  });
});

describe("authentication rate limits are durable and shared across instances", () => {
  it("blocks the 6th sign-in attempt per minute from one IP, even on a second app instance", async () => {
    const opts = { db, secret: "test-secret-test-secret-test-secret-123", baseURL: "http://localhost:3000" };
    const instanceA = createAuth(opts);
    const instanceB = createAuth(opts); // another serverless instance: no shared memory
    const attempt = (auth: typeof instanceA) =>
      auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": "198.51.100.7" },
          body: JSON.stringify({ email: "nobody@example.test", password: "wrong-password-123" }),
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await attempt(i % 2 ? instanceB : instanceA)).status);
    expect(statuses.every((s) => s !== 429)).toBe(true);
    expect((await attempt(instanceB)).status).toBe(429);
    expect((await db.select().from(rateLimit)).length).toBeGreaterThan(0);
  });
});
