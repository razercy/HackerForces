import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, lte, ne, or, sql } from "drizzle-orm";
import { scoreAssessment, RULESET_VERSION, type Cohort } from "@/lib/integrity/baseline";
import { FEATURE_NAMES, FEATURE_SET_VERSION, extractFeatures, type AnalysisInput, type Features } from "@/lib/integrity/features";
import type { Db, Tx } from "@/lib/server/db";
import { analysisJob, anomalyAssessment, contest, featureVector, ideSession, problem, submission, telemetryEvent } from "@/lib/server/db/schema";
import { frozenTemplatesFor, snippetsInEffect } from "@/lib/server/services/templates";

export type Subject = { userId: string; contestId: string; problemId: string };
type Clock = () => Date;

export const ANALYSIS_LEASE_MS = 120_000;
export const ANALYSIS_MAX_ATTEMPTS = 3;

/** Canonical JSON: object keys sorted, Dates as ISO strings. */
function canonical(value: unknown): string {
  return JSON.stringify(value, function (this: unknown, _k, v) {
    if (v instanceof Date) return v.toISOString();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, (v as Record<string, unknown>)[k]]));
    }
    return v;
  });
}
const digest = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");

// ---------------------------------------------------------------- input loading

/** Everything the feature extractor sees, in a deterministic order. */
export async function loadAnalysisInput(db: Db, s: Subject): Promise<AnalysisInput | null> {
  const [c] = await db.select().from(contest).where(eq(contest.id, s.contestId));
  const [p] = await db.select({ difficulty: problem.difficulty }).from(problem).where(eq(problem.id, s.problemId));
  if (!c || !p) return null;

  const [sessions, subs] = await Promise.all([
    db
      .select()
      .from(ideSession)
      .where(and(eq(ideSession.userId, s.userId), eq(ideSession.contestId, s.contestId), eq(ideSession.problemId, s.problemId)))
      .orderBy(asc(ideSession.startedAt), asc(ideSession.id)),
    db
      .select({
        id: submission.id,
        kind: submission.kind,
        createdAt: submission.createdAt,
        status: submission.status,
        verdict: submission.verdict,
        source: submission.source,
        sourceSha256: submission.sourceSha256,
        ideSessionId: submission.ideSessionId,
        ideSeq: submission.ideSeq,
      })
      .from(submission)
      .where(and(eq(submission.userId, s.userId), eq(submission.contestId, s.contestId), eq(submission.problemId, s.problemId)))
      .orderBy(asc(submission.createdAt), asc(submission.id)),
  ]);
  const events = sessions.length
    ? await db
        .select({ sessionId: telemetryEvent.sessionId, seq: telemetryEvent.seq, type: telemetryEvent.type, clientTs: telemetryEvent.clientTs, receivedAt: telemetryEvent.receivedAt, arrival: telemetryEvent.arrival, payload: telemetryEvent.payload })
        .from(telemetryEvent)
        .where(inArray(telemetryEvent.sessionId, sessions.map((x) => x.id)))
        .orderBy(asc(telemetryEvent.sessionId), asc(telemetryEvent.seq))
    : [];

  // Templates frozen at contest start; snippets in effect at the end of the contest window.
  const [personal, snippets] = await Promise.all([frozenTemplatesFor(db, s.userId, c.startsAt), snippetsInEffect(db, s.contestId, c.endsAt)]);
  const templates = [...snippets, ...personal].sort((a, b) => (a.kind + a.sourceSha256).localeCompare(b.kind + b.sourceSha256));

  return {
    contest: { startsAt: c.startsAt, endsAt: c.endsAt },
    problem: { difficulty: p.difficulty },
    sessions: sessions.map((x) => ({
      id: x.id,
      startedAt: x.startedAt,
      maxSeq: x.maxSeq,
      purged: !!x.purgedAt,
      events: events.filter((e) => e.sessionId === x.id).map(({ sessionId: _s, ...e }) => e),
    })),
    submissions: subs,
    templates,
  };
}

// ---------------------------------------------------------------- one analysis

/** Peers' latest usable feature vectors for the same problem in the same contest. */
async function loadCohort(db: Db, s: Subject): Promise<Cohort> {
  const rows = await db
    .selectDistinctOn([featureVector.userId], { userId: featureVector.userId, features: featureVector.features, dataQuality: featureVector.dataQuality })
    .from(featureVector)
    .where(and(eq(featureVector.contestId, s.contestId), eq(featureVector.problemId, s.problemId), eq(featureVector.featureSetVersion, FEATURE_SET_VERSION), ne(featureVector.userId, s.userId)))
    .orderBy(featureVector.userId, desc(featureVector.computedAt));
  const cohort: Cohort = {};
  for (const r of rows) {
    if ((r.dataQuality as { insufficient?: boolean }).insufficient) continue; // poor data must not shape the reference
    const feats = r.features as Features;
    for (const name of FEATURE_NAMES) {
      const v = feats[name];
      if (v?.available && typeof v.value === "number") (cohort[name] ??= []).push(v.value);
    }
  }
  for (const k of Object.keys(cohort) as (keyof Cohort)[]) cohort[k]!.sort((a, b) => a - b);
  return cohort;
}

export type AnalysisOutcome = "assessed" | "unchanged" | "no_submission";

/**
 * Extract → persist features (deduplicated by input digest) → score against
 * the current cohort → append an assessment unless identical to the latest.
 */
export async function runAnalysis(db: Db, s: Subject, now: Date): Promise<AnalysisOutcome> {
  const input = await loadAnalysisInput(db, s);
  if (!input) return "no_submission";
  const extraction = extractFeatures(input);
  if (!extraction) return "no_submission";

  const inputsDigest = digest({ v: FEATURE_SET_VERSION, input });
  await db
    .insert(featureVector)
    .values({ ...s, featureSetVersion: FEATURE_SET_VERSION, inputsDigest, features: extraction.features, dataQuality: { ...extraction.dataQuality, target: extraction.target }, computedAt: now })
    .onConflictDoNothing();
  const [fv] = await db
    .select({ id: featureVector.id })
    .from(featureVector)
    .where(and(eq(featureVector.userId, s.userId), eq(featureVector.contestId, s.contestId), eq(featureVector.problemId, s.problemId), eq(featureVector.featureSetVersion, FEATURE_SET_VERSION), eq(featureVector.inputsDigest, inputsDigest)));

  const cohort = await loadCohort(db, s);
  const result = scoreAssessment(extraction, cohort);
  const referenceDigest = digest({ r: RULESET_VERSION, cohort });

  const [latest] = await db
    .select({ featureVectorId: anomalyAssessment.featureVectorId, referenceDigest: anomalyAssessment.referenceDigest, rulesetVersion: anomalyAssessment.rulesetVersion })
    .from(anomalyAssessment)
    .where(and(eq(anomalyAssessment.userId, s.userId), eq(anomalyAssessment.contestId, s.contestId), eq(anomalyAssessment.problemId, s.problemId)))
    .orderBy(desc(anomalyAssessment.computedAt))
    .limit(1);
  if (latest && latest.featureVectorId === fv!.id && latest.referenceDigest === referenceDigest && latest.rulesetVersion === RULESET_VERSION) return "unchanged";

  await db.insert(anomalyAssessment).values({
    ...s,
    featureVectorId: fv!.id,
    rulesetVersion: RULESET_VERSION,
    score: result.score,
    band: result.band,
    referenceDigest,
    reference: result.reference,
    contributions: result.contributions,
    evidence: extraction.evidence,
    warnings: [...result.warnings, ...extraction.dataQuality.warnings],
    computedAt: now,
  });
  return "assessed";
}

// ---------------------------------------------------------------- durable queue

/**
 * Idempotent enqueue. A pending job is simply made available now; a job a
 * worker currently holds is flagged for one more run after it finishes.
 */
export async function enqueueAnalysis(db: Db | Tx, s: Subject, now: Date): Promise<void> {
  await db
    .insert(analysisJob)
    .values({ ...s, status: "pending", availableAt: now })
    .onConflictDoUpdate({
      target: [analysisJob.userId, analysisJob.contestId, analysisJob.problemId],
      set: {
        status: sql`CASE WHEN ${analysisJob.status} = 'claimed' THEN 'claimed'::analysis_job_status ELSE 'pending'::analysis_job_status END`,
        rerunRequested: sql`CASE WHEN ${analysisJob.status} = 'claimed' THEN 1 ELSE 0 END`,
        attempts: sql`CASE WHEN ${analysisJob.status} = 'claimed' THEN ${analysisJob.attempts} ELSE 0 END`,
        availableAt: sql`CASE WHEN ${analysisJob.status} = 'claimed' THEN ${analysisJob.availableAt} ELSE ${now} END`,
        lastError: null,
      },
    });
}

type Claim = { jobId: string; attempt: number; subject: Subject };

export async function claimAnalysisJob(db: Db, now: Date): Promise<Claim | null> {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(analysisJob)
      .where(or(and(eq(analysisJob.status, "pending"), lte(analysisJob.availableAt, now)), and(eq(analysisJob.status, "claimed"), lt(analysisJob.leaseUntil, now))))
      .orderBy(asc(analysisJob.availableAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!job) return null;
    if (job.attempts >= ANALYSIS_MAX_ATTEMPTS) {
      await tx.update(analysisJob).set({ status: "dead", leaseUntil: null }).where(eq(analysisJob.id, job.id));
      return null;
    }
    const attempt = job.attempts + 1;
    await tx.update(analysisJob).set({ status: "claimed", attempts: attempt, leaseUntil: new Date(now.getTime() + ANALYSIS_LEASE_MS) }).where(eq(analysisJob.id, job.id));
    return { jobId: job.id, attempt, subject: { userId: job.userId, contestId: job.contestId, problemId: job.problemId } };
  });
}

const holds = (c: Claim) => and(eq(analysisJob.id, c.jobId), eq(analysisJob.attempts, c.attempt), eq(analysisJob.status, "claimed"));

export async function processAnalysisJob(db: Db, claim: Claim, clock: Clock = () => new Date()) {
  try {
    const outcome = await runAnalysis(db, claim.subject, clock());
    // Finish, or go round again if new data arrived while we were running.
    await db
      .update(analysisJob)
      .set({
        status: sql`CASE WHEN ${analysisJob.rerunRequested} = 1 THEN 'pending'::analysis_job_status ELSE 'done'::analysis_job_status END`,
        attempts: sql`CASE WHEN ${analysisJob.rerunRequested} = 1 THEN 0 ELSE ${analysisJob.attempts} END`,
        rerunRequested: 0,
        leaseUntil: null,
        availableAt: clock(),
        lastError: null,
      })
      .where(holds(claim));
    return outcome;
  } catch (err) {
    console.error(`analysis job ${claim.jobId} failed`, err);
    const final = claim.attempt >= ANALYSIS_MAX_ATTEMPTS;
    await db
      .update(analysisJob)
      .set({
        status: final ? "dead" : "pending",
        leaseUntil: null,
        availableAt: new Date(clock().getTime() + 10_000 * claim.attempt),
        lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      })
      .where(holds(claim));
    return "failed" as const;
  }
}

export async function drainAnalysisJobs(db: Db, { maxJobs = 5, budgetMs = 20_000, clock = () => new Date() }: { maxJobs?: number; budgetMs?: number; clock?: Clock } = {}) {
  const deadline = clock().getTime() + budgetMs;
  let processed = 0;
  while (processed < maxJobs && clock().getTime() < deadline) {
    const claim = await claimAnalysisJob(db, clock());
    if (!claim) break;
    await processAnalysisJob(db, claim, clock);
    processed++;
  }
  return { processed };
}

/**
 * Contest-end sweep: re-enqueue every subject of recently ended contests so
 * assessments are re-scored against the complete cohort.
 */
export async function enqueueEndedContests(db: Db, { now = new Date(), lookbackMs = 3 * 24 * 3600_000 } = {}) {
  const subjects = await db
    .selectDistinct({ userId: submission.userId, contestId: submission.contestId, problemId: submission.problemId })
    .from(submission)
    .innerJoin(contest, eq(contest.id, submission.contestId))
    .where(and(eq(submission.kind, "submission"), lt(contest.endsAt, now), sql`${contest.endsAt} > ${new Date(now.getTime() - lookbackMs)}`));
  for (const s of subjects) await enqueueAnalysis(db, s, now);
  return { enqueued: subjects.length };
}
