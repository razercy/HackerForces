import "server-only";
import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import { hasPermission } from "@/lib/auth/roles";
import { explain, type Assessment } from "@/lib/integrity/baseline";
import type { Features } from "@/lib/integrity/features";
import type { Db } from "@/lib/server/db";
import { anomalyAssessment, contest, contestProblem, featureVector, ideSession, problem, user } from "@/lib/server/db/schema";
import { forbidden, notFound } from "@/lib/server/errors";
import type { Principal } from "@/lib/server/services/roles";
import { isUuid } from "@/lib/validation/ids";

export type AssessmentFilters = { contestSlug?: string; band?: "typical" | "elevated" | "insufficient_data"; minScore?: number; maxScore?: number; userId?: string; limit?: number };

const assertReviewer = (viewer: Principal) => {
  if (!hasPermission(viewer.roles, "integrity:review")) throw forbidden();
};

/** Latest assessment per subject, most concerning first. Reviewer-only. */
export async function listLatestAssessments(db: Db, viewer: Principal, filters: AssessmentFilters = {}) {
  assertReviewer(viewer);
  const conds: SQL[] = [];
  if (filters.contestSlug) conds.push(eq(contest.slug, filters.contestSlug));
  if (filters.userId) conds.push(eq(anomalyAssessment.userId, filters.userId));

  const latest = await db
    .selectDistinctOn([anomalyAssessment.userId, anomalyAssessment.contestId, anomalyAssessment.problemId], {
      id: anomalyAssessment.id,
      userId: anomalyAssessment.userId,
      userName: user.name,
      contestSlug: contest.slug,
      contestTitle: contest.title,
      label: contestProblem.label,
      problemTitle: problem.title,
      score: anomalyAssessment.score,
      band: anomalyAssessment.band,
      rulesetVersion: anomalyAssessment.rulesetVersion,
      computedAt: anomalyAssessment.computedAt,
    })
    .from(anomalyAssessment)
    .innerJoin(user, eq(user.id, anomalyAssessment.userId))
    .innerJoin(contest, eq(contest.id, anomalyAssessment.contestId))
    .innerJoin(problem, eq(problem.id, anomalyAssessment.problemId))
    .leftJoin(contestProblem, and(eq(contestProblem.contestId, anomalyAssessment.contestId), eq(contestProblem.problemId, anomalyAssessment.problemId)))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(anomalyAssessment.userId, anomalyAssessment.contestId, anomalyAssessment.problemId, desc(anomalyAssessment.computedAt));

  const bandRank = { elevated: 0, typical: 1, insufficient_data: 2 } as const;
  return latest
    .filter((a) => (!filters.band || a.band === filters.band) && (filters.minScore == null || (a.score ?? -1) >= filters.minScore) && (filters.maxScore == null || (a.score ?? 101) <= filters.maxScore))
    .sort((a, b) => bandRank[a.band] - bandRank[b.band] || (b.score ?? -1) - (a.score ?? -1) || a.userName.localeCompare(b.userName))
    .slice(0, Math.min(filters.limit ?? 100, 500));
}

/** One assessment with its features, explanations, sessions and scoring history. Reviewer-only. */
export async function getAssessment(db: Db, viewer: Principal, id: string) {
  assertReviewer(viewer);
  if (!isUuid(id)) throw notFound("Assessment");
  const [row] = await db
    .select({ a: anomalyAssessment, fv: featureVector, userName: user.name, contestSlug: contest.slug, contestTitle: contest.title, problemTitle: problem.title, label: contestProblem.label })
    .from(anomalyAssessment)
    .innerJoin(featureVector, eq(featureVector.id, anomalyAssessment.featureVectorId))
    .innerJoin(user, eq(user.id, anomalyAssessment.userId))
    .innerJoin(contest, eq(contest.id, anomalyAssessment.contestId))
    .innerJoin(problem, eq(problem.id, anomalyAssessment.problemId))
    .leftJoin(contestProblem, and(eq(contestProblem.contestId, anomalyAssessment.contestId), eq(contestProblem.problemId, anomalyAssessment.problemId)))
    .where(eq(anomalyAssessment.id, id));
  if (!row) throw notFound("Assessment");
  const { a, fv } = row;
  const subject = and(eq(anomalyAssessment.userId, a.userId), eq(anomalyAssessment.contestId, a.contestId), eq(anomalyAssessment.problemId, a.problemId));

  const [history, sessions] = await Promise.all([
    db
      .select({ id: anomalyAssessment.id, score: anomalyAssessment.score, band: anomalyAssessment.band, rulesetVersion: anomalyAssessment.rulesetVersion, computedAt: anomalyAssessment.computedAt })
      .from(anomalyAssessment)
      .where(subject)
      .orderBy(desc(anomalyAssessment.computedAt)),
    db
      .select({ id: ideSession.id, startedAt: ideSession.startedAt, receivedCount: ideSession.receivedCount, purgedAt: ideSession.purgedAt })
      .from(ideSession)
      .where(and(eq(ideSession.userId, a.userId), eq(ideSession.contestId, a.contestId), eq(ideSession.problemId, a.problemId)))
      .orderBy(asc(ideSession.startedAt)),
  ]);

  const features = fv.features as Features;
  const scored = { contributions: a.contributions, score: a.score, band: a.band } as unknown as Assessment;
  return {
    id: a.id,
    subject: { userId: a.userId, userName: row.userName, contestSlug: row.contestSlug, contestTitle: row.contestTitle, label: row.label, problemTitle: row.problemTitle },
    score: a.score,
    band: a.band,
    rulesetVersion: a.rulesetVersion,
    featureSetVersion: fv.featureSetVersion,
    inputsDigest: fv.inputsDigest,
    computedAt: a.computedAt,
    reference: a.reference,
    contributions: a.contributions,
    explanations: explain(scored, features),
    evidence: a.evidence,
    warnings: a.warnings,
    features,
    dataQuality: fv.dataQuality,
    sessions,
    history,
  };
}

