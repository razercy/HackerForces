import "server-only";
import { and, count, desc, eq, min } from "drizzle-orm";
import { hasPermission } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/server/audit";
import type { Db } from "@/lib/server/db";
import { analysisJob, judgeJob, submission } from "@/lib/server/db/schema";
import { forbidden, notFound } from "@/lib/server/errors";
import type { JudgeProvider } from "@/lib/server/judge/types";
import { isUuid } from "@/lib/validation/ids";
import type { Principal } from "./roles";

type Clock = { now?: Date };

function assertOps(viewer: Principal) {
  if (!hasPermission(viewer.roles, "ops:manage")) throw forbidden();
}

/** Queue health for the operations page. Error texts are infrastructure messages only (never test data). */
export async function queueHealth(db: Db, viewer: Principal) {
  assertOps(viewer);
  const [judgeByStatus, judgeOldest, deadJudge, analysisByStatus, deadAnalysis] = await Promise.all([
    db.select({ status: judgeJob.status, n: count() }).from(judgeJob).groupBy(judgeJob.status),
    db.select({ oldest: min(judgeJob.createdAt) }).from(judgeJob).where(eq(judgeJob.status, "pending")),
    db
      .select({ id: judgeJob.id, submissionId: judgeJob.submissionId, attempts: judgeJob.attempts, lastError: judgeJob.lastError, updatedAt: judgeJob.updatedAt })
      .from(judgeJob)
      .where(eq(judgeJob.status, "dead"))
      .orderBy(desc(judgeJob.updatedAt))
      .limit(50),
    db.select({ status: analysisJob.status, n: count() }).from(analysisJob).groupBy(analysisJob.status),
    db
      .select({ id: analysisJob.id, attempts: analysisJob.attempts, lastError: analysisJob.lastError, updatedAt: analysisJob.updatedAt })
      .from(analysisJob)
      .where(eq(analysisJob.status, "dead"))
      .orderBy(desc(analysisJob.updatedAt))
      .limit(50),
  ]);
  const toMap = (rows: { status: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  return {
    judge: { byStatus: toMap(judgeByStatus), oldestPending: judgeOldest[0]?.oldest ?? null, dead: deadJudge },
    analysis: { byStatus: toMap(analysisByStatus), dead: deadAnalysis },
  };
}

/** Puts a dead judge job back in the queue; its submission returns to "queued". Audited. */
export async function requeueDeadJudgeJob(db: Db, viewer: Principal, jobId: string, { now = new Date() }: Clock = {}) {
  assertOps(viewer);
  if (!isUuid(jobId)) throw notFound("Job");
  await db.transaction(async (tx) => {
    const [job] = await tx
      .update(judgeJob)
      .set({ status: "pending", attempts: 0, availableAt: now, leaseUntil: null, lastError: null })
      .where(and(eq(judgeJob.id, jobId), eq(judgeJob.status, "dead")))
      .returning({ submissionId: judgeJob.submissionId });
    if (!job) throw notFound("Dead job");
    await tx.update(submission).set({ status: "queued" }).where(eq(submission.id, job.submissionId));
    await recordAudit(tx, { actorId: viewer.userId, action: "ops.judge_job.requeue", targetType: "judge_job", targetId: jobId, metadata: { submissionId: job.submissionId } });
  });
}

export async function requeueDeadAnalysisJob(db: Db, viewer: Principal, jobId: string, { now = new Date() }: Clock = {}) {
  assertOps(viewer);
  if (!isUuid(jobId)) throw notFound("Job");
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(analysisJob)
      .set({ status: "pending", attempts: 0, availableAt: now, leaseUntil: null, lastError: null })
      .where(and(eq(analysisJob.id, jobId), eq(analysisJob.status, "dead")))
      .returning({ id: analysisJob.id });
    if (updated.length === 0) throw notFound("Dead job");
    await recordAudit(tx, { actorId: viewer.userId, action: "ops.analysis_job.requeue", targetType: "analysis_job", targetId: jobId });
  });
}

/** Judge reachability without revealing its URL or credentials. */
export async function judgeStatus(judge: JudgeProvider): Promise<{ provider: string; reachable: boolean | null }> {
  const pingable = judge as JudgeProvider & { ping?: (s: AbortSignal) => Promise<boolean> };
  if (!pingable.ping) return { provider: judge.name, reachable: null };
  return { provider: judge.name, reachable: await pingable.ping(AbortSignal.timeout(5_000)) };
}

