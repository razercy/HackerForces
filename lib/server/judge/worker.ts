import "server-only";
import { and, asc, eq, lt, lte, or } from "drizzle-orm";
import type { Db } from "@/lib/server/db";
import { judgeJob, problem, problemExample, problemTest, submission } from "@/lib/server/db/schema";
import type { JudgeProvider, JudgeRequest, JudgeResult } from "./types";

/** A claimed job is exclusively ours until the lease expires. */
export const LEASE_MS = 60_000;
/** Must leave headroom inside the lease for persisting the result. */
export const JUDGE_TIMEOUT_MS = 45_000;
export const MAX_ATTEMPTS = 3;
const MAX_COMPILE_OUTPUT = 16_000;
const backoffMs = (attempt: number) => 5_000 * 2 ** (attempt - 1);

type Clock = () => Date;
export type Claim = { jobId: string; submissionId: string; attempt: number };

const claimable = (now: Date) =>
  or(
    and(eq(judgeJob.status, "pending"), lte(judgeJob.availableAt, now)),
    and(eq(judgeJob.status, "claimed"), lt(judgeJob.leaseUntil, now)),
  );

/**
 * Atomically claims the oldest claimable job. Concurrent workers skip rows
 * another transaction has locked, so each job is handed to exactly one worker.
 * A job whose lease expired after its final attempt is marked dead instead.
 */
export async function claimNextJob(db: Db, now: Date): Promise<Claim | null> {
  for (;;) {
    const outcome = await db.transaction(async (tx) => {
      const [job] = await tx
        .select({ id: judgeJob.id, submissionId: judgeJob.submissionId, attempts: judgeJob.attempts })
        .from(judgeJob)
        .where(claimable(now))
        .orderBy(asc(judgeJob.availableAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!job) return { kind: "empty" as const };

      if (job.attempts >= MAX_ATTEMPTS) {
        await tx.update(judgeJob).set({ status: "dead", leaseUntil: null, lastError: "Lease expired on final attempt" }).where(eq(judgeJob.id, job.id));
        await tx.update(submission).set({ status: "failed" }).where(eq(submission.id, job.submissionId));
        return { kind: "dead" as const };
      }

      const attempt = job.attempts + 1;
      await tx
        .update(judgeJob)
        .set({ status: "claimed", attempts: attempt, leaseUntil: new Date(now.getTime() + LEASE_MS) })
        .where(eq(judgeJob.id, job.id));
      await tx.update(submission).set({ status: "running" }).where(eq(submission.id, job.submissionId));
      return { kind: "claimed" as const, claim: { jobId: job.id, submissionId: job.submissionId, attempt } };
    });
    if (outcome.kind === "empty") return null;
    if (outcome.kind === "claimed") return outcome.claim;
    // A dead job was swept; look for the next one.
  }
}

async function buildRequest(db: Db, submissionId: string): Promise<JudgeRequest> {
  const [s] = await db
    .select({
      id: submission.id,
      kind: submission.kind,
      language: submission.language,
      source: submission.source,
      problemId: submission.problemId,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
    })
    .from(submission)
    .innerJoin(problem, eq(problem.id, submission.problemId))
    .where(eq(submission.id, submissionId));
  if (!s) throw new Error(`Submission ${submissionId} not found`);

  const tests =
    s.kind === "submission"
      ? await db
          .select({ ordinal: problemTest.ordinal, input: problemTest.input, expectedOutput: problemTest.expectedOutput })
          .from(problemTest)
          .where(eq(problemTest.problemId, s.problemId))
          .orderBy(asc(problemTest.ordinal))
      : await db
          .select({ ordinal: problemExample.ordinal, input: problemExample.input, expectedOutput: problemExample.output })
          .from(problemExample)
          .where(eq(problemExample.problemId, s.problemId))
          .orderBy(asc(problemExample.ordinal));
  return { submissionId: s.id, language: s.language, source: s.source, timeLimitMs: s.timeLimitMs, memoryLimitMb: s.memoryLimitMb, tests };
}

/** Fencing: only the holder of the current attempt may write. */
const holdsLease = (claim: Claim) =>
  and(eq(judgeJob.id, claim.jobId), eq(judgeJob.attempts, claim.attempt), eq(judgeJob.status, "claimed"));

async function recordResult(db: Db, claim: Claim, result: JudgeResult, providerName: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const won = await tx.update(judgeJob).set({ status: "done", leaseUntil: null, lastError: null }).where(holdsLease(claim)).returning({ id: judgeJob.id });
    if (won.length === 0) return false; // Lease was lost; a newer attempt owns the job.
    await tx
      .update(submission)
      .set({
        status: "judged",
        verdict: result.verdict,
        timeMs: result.timeMs,
        memoryKb: result.memoryKb,
        passedTests: result.passedTests,
        totalTests: result.totalTests,
        failedTest: result.failedTest,
        compileOutput: result.compileOutput?.slice(0, MAX_COMPILE_OUTPUT) ?? null,
        judgeProvider: providerName,
        judgedAt: now,
      })
      .where(eq(submission.id, claim.submissionId));
    return true;
  });
}

async function recordFailure(db: Db, claim: Claim, err: unknown, now: Date): Promise<void> {
  const message = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 500);
  await db.transaction(async (tx) => {
    const final = claim.attempt >= MAX_ATTEMPTS;
    const updated = await tx
      .update(judgeJob)
      .set(
        final
          ? { status: "dead", leaseUntil: null, lastError: message }
          : { status: "pending", leaseUntil: null, lastError: message, availableAt: new Date(now.getTime() + backoffMs(claim.attempt)) },
      )
      .where(holdsLease(claim))
      .returning({ id: judgeJob.id });
    if (updated.length === 0) return;
    await tx.update(submission).set({ status: final ? "failed" : "queued" }).where(eq(submission.id, claim.submissionId));
  });
}

export type ProcessOutcome = "judged" | "retry" | "lost_lease";

export async function processJob(db: Db, judge: JudgeProvider, claim: Claim, clock: Clock = () => new Date()): Promise<ProcessOutcome> {
  try {
    const request = await buildRequest(db, claim.submissionId);
    const result = await judge.judge(request, { signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS) });
    return (await recordResult(db, claim, result, judge.name, clock())) ? "judged" : "lost_lease";
  } catch (err) {
    console.error(`judge job ${claim.jobId} attempt ${claim.attempt} failed`, err);
    await recordFailure(db, claim, err, clock());
    return "retry";
  }
}

/**
 * Processes claimable jobs until the queue is empty or the budget runs out.
 * Safe to call concurrently from any number of function instances.
 */
export async function drainJobs(
  db: Db,
  judge: JudgeProvider,
  { maxJobs = 10, budgetMs = 50_000, clock = () => new Date() }: { maxJobs?: number; budgetMs?: number; clock?: Clock } = {},
): Promise<{ processed: number }> {
  const deadline = clock().getTime() + budgetMs;
  let processed = 0;
  // Callers size budgetMs so that budget + JUDGE_TIMEOUT_MS fits the function's max duration.
  while (processed < maxJobs && clock().getTime() < deadline) {
    const claim = await claimNextJob(db, clock());
    if (!claim) break;
    await processJob(db, judge, claim, clock);
    processed++;
  }
  return { processed };
}

/** Whether a submission's job is waiting for a worker (used to re-kick from status polls). */
export async function hasClaimableJob(db: Db, submissionId: string, now: Date): Promise<boolean> {
  const rows = await db.select({ id: judgeJob.id }).from(judgeJob).where(and(eq(judgeJob.submissionId, submissionId), claimable(now)));
  return rows.length > 0;
}
