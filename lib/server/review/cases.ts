import "server-only";
import { and, asc, desc, eq, inArray, ne, type SQL } from "drizzle-orm";
import { hasPermission } from "@/lib/auth/roles";
import { MIN_RATIONALE, REVIEW_OUTCOMES, type CaseStatus, type ReviewOutcome } from "@/lib/review";
import { recordAudit } from "@/lib/server/audit";
import type { Db, Tx } from "@/lib/server/db";
import { isUniqueViolation } from "@/lib/server/db/errors";
import {
  anomalyAssessment,
  contest,
  contestProblem,
  contestantResponse,
  decisionConfirmation,
  problem,
  reviewCase,
  reviewDecision,
  reviewNote,
  submission,
  user,
} from "@/lib/server/db/schema";
import { AppError, forbidden, notFound } from "@/lib/server/errors";
import type { Principal } from "@/lib/server/services/roles";
import { frozenTemplatesFor, snippetsInEffect } from "@/lib/server/services/templates";
import { isUuid } from "@/lib/validation/ids";
import { z } from "zod";

type Clock = { now?: Date };
export type Subject = { userId: string; contestId: string; problemId: string };

const conflict = (message: string) => new AppError("CONFLICT", message, 409);

/**
 * Separation of duties: nobody reviews their own work or a contest they
 * created (this applies to admins too: admins manage everything, so only
 * authorship counts here).
 */
export function hasConflictOfInterest(actor: Principal, c: { userId: string; contestCreatedBy: string }): boolean {
  return actor.userId === c.userId || actor.userId === c.contestCreatedBy;
}

function assertReviewer(viewer: Principal) {
  if (!hasPermission(viewer.roles, "integrity:review")) throw forbidden();
}

async function loadCase(db: Db | Tx, caseId: string, { lock = false } = {}) {
  if (!isUuid(caseId)) throw notFound("Case");
  const q = db
    .select({ c: reviewCase, contestCreatedBy: contest.createdBy })
    .from(reviewCase)
    .innerJoin(contest, eq(contest.id, reviewCase.contestId))
    .where(eq(reviewCase.id, caseId));
  const [row] = lock ? await q.for("update", { of: reviewCase }) : await q;
  if (!row) throw notFound("Case");
  return { ...row.c, contestCreatedBy: row.contestCreatedBy };
}

async function lockActionableCase(tx: Tx, viewer: Principal, caseId: string) {
  assertReviewer(viewer);
  const c = await loadCase(tx, caseId, { lock: true });
  if (hasConflictOfInterest(viewer, { userId: c.userId, contestCreatedBy: c.contestCreatedBy })) {
    throw new AppError("FORBIDDEN", "You have a conflict of interest for this case", 403);
  }
  return c;
}

// ---------------------------------------------------------------- opening cases

/**
 * Opened by the system for an elevated assessment. Only the first elevated
 * assessment of a subject opens a case; later changes appear in the queue
 * as "new assessment since decision" instead of re-opening automatically.
 */
export async function openCaseForAssessment(db: Db | Tx, s: Subject, assessmentId: string, now: Date): Promise<string | null> {
  const existing = await db
    .select({ id: reviewCase.id })
    .from(reviewCase)
    .where(and(eq(reviewCase.userId, s.userId), eq(reviewCase.contestId, s.contestId), eq(reviewCase.problemId, s.problemId)))
    .limit(1);
  if (existing.length > 0) return null;
  try {
    const [row] = await db.insert(reviewCase).values({ ...s, openedReason: "elevated_assessment", assessmentId, createdAt: now }).returning({ id: reviewCase.id });
    await recordAudit(db, { actorId: null, action: "review.case.open", targetType: "review_case", targetId: row!.id, metadata: { reason: "elevated_assessment", assessmentId } });
    return row!.id;
  } catch (err) {
    if (isUniqueViolation(err)) return null; // opened concurrently
    throw err;
  }
}

/** A reviewer opens (or returns the existing active) case for an assessment's subject. */
export async function openCaseManually(db: Db, viewer: Principal, assessmentId: string, { now = new Date() }: Clock = {}): Promise<{ id: string; created: boolean }> {
  assertReviewer(viewer);
  if (!isUuid(assessmentId)) throw notFound("Assessment");
  const [a] = await db
    .select({ userId: anomalyAssessment.userId, contestId: anomalyAssessment.contestId, problemId: anomalyAssessment.problemId, createdBy: contest.createdBy })
    .from(anomalyAssessment)
    .innerJoin(contest, eq(contest.id, anomalyAssessment.contestId))
    .where(eq(anomalyAssessment.id, assessmentId));
  if (!a) throw notFound("Assessment");
  if (hasConflictOfInterest(viewer, { userId: a.userId, contestCreatedBy: a.createdBy })) throw new AppError("FORBIDDEN", "You have a conflict of interest for this case", 403);

  return db.transaction(async (tx) => {
    const [active] = await tx
      .select({ id: reviewCase.id })
      .from(reviewCase)
      .where(and(eq(reviewCase.userId, a.userId), eq(reviewCase.contestId, a.contestId), eq(reviewCase.problemId, a.problemId), ne(reviewCase.status, "closed")));
    if (active) return { id: active.id, created: false };
    const [row] = await tx
      .insert(reviewCase)
      .values({ userId: a.userId, contestId: a.contestId, problemId: a.problemId, openedReason: "manual", openedBy: viewer.userId, assessmentId, createdAt: now })
      .returning({ id: reviewCase.id });
    await recordAudit(tx, { actorId: viewer.userId, action: "review.case.open", targetType: "review_case", targetId: row!.id, metadata: { reason: "manual", assessmentId } });
    return { id: row!.id, created: true };
  });
}

// ---------------------------------------------------------------- queue

export type CaseFilters = {
  contestSlug?: string;
  label?: string;
  contestant?: string;
  status?: CaseStatus | "active";
  band?: "typical" | "elevated" | "insufficient_data";
  minScore?: number;
  maxScore?: number;
  page?: number;
  pageSize?: number;
};

/** Review queue: cases with their latest assessment, active and most concerning first. */
export async function listCases(db: Db, viewer: Principal, f: CaseFilters = {}) {
  assertReviewer(viewer);
  const conds: SQL[] = [];
  if (f.contestSlug) conds.push(eq(contest.slug, f.contestSlug));
  if (f.label) conds.push(eq(contestProblem.label, f.label.toUpperCase()));
  if (f.status && f.status !== "active") conds.push(eq(reviewCase.status, f.status));
  if (f.status === "active") conds.push(ne(reviewCase.status, "closed"));

  const rows = await db
    .select({
      id: reviewCase.id,
      status: reviewCase.status,
      openedReason: reviewCase.openedReason,
      createdAt: reviewCase.createdAt,
      updatedAt: reviewCase.updatedAt,
      userId: reviewCase.userId,
      contestId: reviewCase.contestId,
      problemId: reviewCase.problemId,
      userName: user.name,
      contestSlug: contest.slug,
      contestTitle: contest.title,
      contestCreatedBy: contest.createdBy,
      label: contestProblem.label,
      problemTitle: problem.title,
    })
    .from(reviewCase)
    .innerJoin(user, eq(user.id, reviewCase.userId))
    .innerJoin(contest, eq(contest.id, reviewCase.contestId))
    .innerJoin(problem, eq(problem.id, reviewCase.problemId))
    .leftJoin(contestProblem, and(eq(contestProblem.contestId, reviewCase.contestId), eq(contestProblem.problemId, reviewCase.problemId)))
    .where(conds.length ? and(...conds) : undefined);
  if (rows.length === 0) return { items: [], total: 0, page: 1, pageSize: f.pageSize ?? 50 };

  const caseIds = rows.map((r) => r.id);
  const [assessments, decisions] = await Promise.all([
    db
      .selectDistinctOn([anomalyAssessment.userId, anomalyAssessment.contestId, anomalyAssessment.problemId], {
        id: anomalyAssessment.id,
        userId: anomalyAssessment.userId,
        contestId: anomalyAssessment.contestId,
        problemId: anomalyAssessment.problemId,
        score: anomalyAssessment.score,
        band: anomalyAssessment.band,
        computedAt: anomalyAssessment.computedAt,
      })
      .from(anomalyAssessment)
      .where(inArray(anomalyAssessment.userId, [...new Set(rows.map((r) => r.userId))]))
      .orderBy(anomalyAssessment.userId, anomalyAssessment.contestId, anomalyAssessment.problemId, desc(anomalyAssessment.computedAt)),
    db.select({ caseId: reviewDecision.caseId, outcome: reviewDecision.outcome, createdAt: reviewDecision.createdAt }).from(reviewDecision).where(inArray(reviewDecision.caseId, caseIds)).orderBy(desc(reviewDecision.createdAt)),
  ]);

  const key = (x: Subject) => `${x.userId}|${x.contestId}|${x.problemId}`;
  const latestBySubject = new Map(assessments.map((a) => [key(a), a]));
  const needle = f.contestant?.trim().toLowerCase();
  const items = rows
    .map((r) => {
      const a = latestBySubject.get(key(r)) ?? null;
      const d = decisions.find((x) => x.caseId === r.id) ?? null;
      return {
        ...r,
        score: a?.score ?? null,
        band: a?.band ?? null,
        assessmentId: a?.id ?? null,
        lastOutcome: d?.outcome ?? null,
        newAssessmentSinceDecision: !!(a && d && a.computedAt > d.createdAt),
        conflictOfInterest: hasConflictOfInterest(viewer, { userId: r.userId, contestCreatedBy: r.contestCreatedBy }),
      };
    })
    .filter((x) => (!needle || x.userName.toLowerCase().includes(needle)) && (!f.band || x.band === f.band))
    .filter((x) => (f.minScore == null || (x.score ?? -1) >= f.minScore) && (f.maxScore == null || (x.score ?? 101) <= f.maxScore));

  const statusRank: Record<CaseStatus, number> = { open: 0, awaiting_confirmation: 1, closed: 2 };
  items.sort((a, b) => statusRank[a.status] - statusRank[b.status] || (b.score ?? -1) - (a.score ?? -1) || b.updatedAt.getTime() - a.updatedAt.getTime());
  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const page = Math.max(1, f.page ?? 1);
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}

// ---------------------------------------------------------------- case detail

export async function getCase(db: Db, viewer: Principal, caseId: string, { now = new Date() }: Clock = {}) {
  assertReviewer(viewer);
  const c = await loadCase(db, caseId);
  const [subjectRow] = await db
    .select({ userName: user.name, contestSlug: contest.slug, contestTitle: contest.title, problemTitle: problem.title, label: contestProblem.label })
    .from(user)
    .innerJoin(contest, eq(contest.id, c.contestId))
    .innerJoin(problem, eq(problem.id, c.problemId))
    .leftJoin(contestProblem, and(eq(contestProblem.contestId, c.contestId), eq(contestProblem.problemId, c.problemId)))
    .where(eq(user.id, c.userId));

  const [decisions, notes, responses, assessments] = await Promise.all([
    db
      .select({ d: reviewDecision, reviewerName: user.name })
      .from(reviewDecision)
      .innerJoin(user, eq(user.id, reviewDecision.reviewerId))
      .where(eq(reviewDecision.caseId, caseId))
      .orderBy(asc(reviewDecision.createdAt)),
    db.select({ n: reviewNote, authorName: user.name }).from(reviewNote).innerJoin(user, eq(user.id, reviewNote.authorId)).where(eq(reviewNote.caseId, caseId)).orderBy(asc(reviewNote.createdAt)),
    db.select().from(contestantResponse).where(eq(contestantResponse.caseId, caseId)).orderBy(asc(contestantResponse.createdAt)),
    db
      .select({ id: anomalyAssessment.id, score: anomalyAssessment.score, band: anomalyAssessment.band, computedAt: anomalyAssessment.computedAt })
      .from(anomalyAssessment)
      .where(and(eq(anomalyAssessment.userId, c.userId), eq(anomalyAssessment.contestId, c.contestId), eq(anomalyAssessment.problemId, c.problemId)))
      .orderBy(desc(anomalyAssessment.computedAt)),
  ]);
  const confirmations = decisions.length
    ? await db
        .select({ k: decisionConfirmation, adminName: user.name })
        .from(decisionConfirmation)
        .innerJoin(user, eq(user.id, decisionConfirmation.adminId))
        .where(inArray(decisionConfirmation.decisionId, decisions.map((d) => d.d.id)))
    : [];

  await recordAudit(db, { actorId: viewer.userId, action: "review.case.view", targetType: "review_case", targetId: caseId });

  const latestDecision = decisions.at(-1)?.d ?? null;
  const conflicted = hasConflictOfInterest(viewer, { userId: c.userId, contestCreatedBy: c.contestCreatedBy });
  return {
    id: c.id,
    status: c.status,
    openedReason: c.openedReason,
    createdAt: c.createdAt,
    subject: { userId: c.userId, contestId: c.contestId, problemId: c.problemId, ...subjectRow! },
    latestAssessmentId: assessments[0]?.id ?? null,
    assessments,
    decisions: decisions.map(({ d, reviewerName }) => {
      const k = confirmations.find((x) => x.k.decisionId === d.id);
      return { ...d, reviewerName, confirmation: k ? { ...k.k, adminName: k.adminName } : null };
    }),
    notes: notes.map(({ n, authorName }) => ({ ...n, authorName })),
    responses,
    permissions: {
      conflictOfInterest: conflicted,
      canDecide: !conflicted && c.status === "open",
      canConfirm:
        !conflicted &&
        c.status === "awaiting_confirmation" &&
        hasPermission(viewer.roles, "integrity:confirm") &&
        latestDecision?.reviewerId !== viewer.userId,
      canReopen: !conflicted && c.status === "closed",
      canNote: !conflicted,
    },
    viewedAt: now,
  };
}

// ---------------------------------------------------------------- actions

const decisionSchema = z
  .object({
    outcome: z.enum(REVIEW_OUTCOMES),
    rationale: z.string().trim().min(MIN_RATIONALE, `Explain the decision in at least ${MIN_RATIONALE} characters`).max(10_000),
    assessmentId: z.uuid().nullable().optional(),
  })
  .strict();
const confirmationSchema = z
  .object({ verdict: z.enum(["confirmed", "rejected"]), rationale: z.string().trim().min(10, "Give a short reason (10+ characters)").max(10_000) })
  .strict();
const textSchema = z.string().trim().min(1).max(5_000);

export async function addNote(db: Db, viewer: Principal, caseId: string, body: unknown, { now = new Date() }: Clock = {}) {
  const text = textSchema.parse(body);
  await db.transaction(async (tx) => {
    await lockActionableCase(tx, viewer, caseId);
    await tx.insert(reviewNote).values({ caseId, authorId: viewer.userId, body: text, createdAt: now });
    await recordAudit(tx, { actorId: viewer.userId, action: "review.note.add", targetType: "review_case", targetId: caseId });
  });
}

/**
 * Records a reviewer's outcome. "No concern" / "inconclusive" close the case;
 * "confirmed violation" waits for a different admin before it takes effect.
 */
export async function recordDecision(db: Db, viewer: Principal, caseId: string, raw: unknown, { now = new Date() }: Clock = {}) {
  const input = decisionSchema.parse(raw);
  return db.transaction(async (tx) => {
    const c = await lockActionableCase(tx, viewer, caseId);
    if (c.status === "awaiting_confirmation") throw conflict("A decision is awaiting confirmation; it must be confirmed or rejected first");
    if (c.status === "closed") throw conflict("Reopen the case before recording a new decision");
    const [prev] = await tx.select({ id: reviewDecision.id }).from(reviewDecision).where(eq(reviewDecision.caseId, caseId)).orderBy(desc(reviewDecision.createdAt)).limit(1);
    const [d] = await tx
      .insert(reviewDecision)
      .values({ caseId, reviewerId: viewer.userId, outcome: input.outcome, rationale: input.rationale, assessmentId: input.assessmentId ?? null, supersedesId: prev?.id ?? null, createdAt: now })
      .returning({ id: reviewDecision.id });
    const status: CaseStatus = input.outcome === "confirmed_violation" ? "awaiting_confirmation" : "closed";
    await tx.update(reviewCase).set({ status, updatedAt: now }).where(eq(reviewCase.id, caseId));
    await recordAudit(tx, { actorId: viewer.userId, action: "review.decision.record", targetType: "review_case", targetId: caseId, metadata: { decisionId: d!.id, outcome: input.outcome } });
    return { decisionId: d!.id, status };
  });
}

/** Second-person step. Confirmed → the violation takes effect; rejected → the case returns to review. */
export async function confirmDecision(db: Db, viewer: Principal, caseId: string, raw: unknown, { now = new Date() }: Clock = {}) {
  const input = confirmationSchema.parse(raw);
  if (!hasPermission(viewer.roles, "integrity:confirm")) throw forbidden();
  return db.transaction(async (tx) => {
    const c = await lockActionableCase(tx, viewer, caseId);
    if (c.status !== "awaiting_confirmation") throw conflict("Nothing is awaiting confirmation on this case");
    const [d] = await tx.select().from(reviewDecision).where(eq(reviewDecision.caseId, caseId)).orderBy(desc(reviewDecision.createdAt)).limit(1);
    if (!d || d.outcome !== "confirmed_violation") throw conflict("Nothing is awaiting confirmation on this case");
    if (d.reviewerId === viewer.userId) throw new AppError("FORBIDDEN", "A decision must be confirmed by a different person", 403);
    await tx.insert(decisionConfirmation).values({ decisionId: d.id, adminId: viewer.userId, verdict: input.verdict, rationale: input.rationale, createdAt: now });
    const status: CaseStatus = input.verdict === "confirmed" ? "closed" : "open";
    await tx.update(reviewCase).set({ status, updatedAt: now }).where(eq(reviewCase.id, caseId));
    await recordAudit(tx, { actorId: viewer.userId, action: `review.decision.${input.verdict === "confirmed" ? "confirm" : "reject"}`, targetType: "review_case", targetId: caseId, metadata: { decisionId: d.id } });
    return { status };
  });
}

export async function reopenCase(db: Db, viewer: Principal, caseId: string, reason: unknown, { now = new Date() }: Clock = {}) {
  const text = textSchema.parse(reason);
  await db.transaction(async (tx) => {
    const c = await lockActionableCase(tx, viewer, caseId);
    if (c.status !== "closed") throw conflict("Only closed cases can be reopened");
    try {
      await tx.update(reviewCase).set({ status: "open", updatedAt: now }).where(eq(reviewCase.id, caseId));
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("Another case for this subject is already active");
      throw err;
    }
    await tx.insert(reviewNote).values({ caseId, authorId: viewer.userId, body: `Reopened: ${text}`, createdAt: now });
    await recordAudit(tx, { actorId: viewer.userId, action: "review.case.reopen", targetType: "review_case", targetId: caseId });
  });
}

// ---------------------------------------------------------------- effects

export type ViolationInEffect = { caseId: string; decisionId: string; effectiveAt: Date };

/**
 * Which (contestant, problem) pairs of a contest carry a confirmed violation
 * right now. Per subject, the latest *final* decision wins: "no concern" /
 * "inconclusive" at their recording time, or a violation at the time a
 * different admin confirmed it. Unconfirmed or rejected violations never count.
 */
export async function violationsInEffect(db: Db | Tx, contestId: string): Promise<Map<string, ViolationInEffect>> {
  const cases = await db.select({ id: reviewCase.id, userId: reviewCase.userId, problemId: reviewCase.problemId }).from(reviewCase).where(eq(reviewCase.contestId, contestId));
  const out = new Map<string, ViolationInEffect>();
  if (cases.length === 0) return out;
  const decisions = await db
    .select({ id: reviewDecision.id, caseId: reviewDecision.caseId, outcome: reviewDecision.outcome, createdAt: reviewDecision.createdAt, verdict: decisionConfirmation.verdict, confirmedAt: decisionConfirmation.createdAt })
    .from(reviewDecision)
    .leftJoin(decisionConfirmation, eq(decisionConfirmation.decisionId, reviewDecision.id))
    .where(inArray(reviewDecision.caseId, cases.map((c) => c.id)));

  const latest = new Map<string, { at: Date; outcome: ReviewOutcome; decisionId: string; caseId: string }>();
  for (const d of decisions) {
    const at = d.outcome === "confirmed_violation" ? (d.verdict === "confirmed" ? d.confirmedAt : null) : d.createdAt;
    if (!at) continue; // not final
    const c = cases.find((x) => x.id === d.caseId)!;
    const k = `${c.userId}|${c.problemId}`;
    const cur = latest.get(k);
    if (!cur || at > cur.at) latest.set(k, { at, outcome: d.outcome, decisionId: d.id, caseId: d.caseId });
  }
  for (const [k, v] of latest) if (v.outcome === "confirmed_violation") out.set(k, { caseId: v.caseId, decisionId: v.decisionId, effectiveAt: v.at });
  return out;
}

// ---------------------------------------------------------------- contestant side

/** Confirmed decisions about the viewer in a contest (in effect or since reversed), with their responses. */
export async function getContestantNotices(db: Db, viewer: Principal, contestId: string) {
  if (!isUuid(contestId)) throw notFound("Contest");
  const rows = await db
    .select({
      caseId: reviewCase.id,
      problemId: reviewCase.problemId,
      label: contestProblem.label,
      problemTitle: problem.title,
      decisionId: reviewDecision.id,
      rationale: reviewDecision.rationale,
      confirmedAt: decisionConfirmation.createdAt,
    })
    .from(reviewCase)
    .innerJoin(reviewDecision, eq(reviewDecision.caseId, reviewCase.id))
    .innerJoin(decisionConfirmation, and(eq(decisionConfirmation.decisionId, reviewDecision.id), eq(decisionConfirmation.verdict, "confirmed")))
    .innerJoin(problem, eq(problem.id, reviewCase.problemId))
    .leftJoin(contestProblem, and(eq(contestProblem.contestId, reviewCase.contestId), eq(contestProblem.problemId, reviewCase.problemId)))
    .where(and(eq(reviewCase.contestId, contestId), eq(reviewCase.userId, viewer.userId)))
    .orderBy(asc(decisionConfirmation.createdAt));
  if (rows.length === 0) return [];
  const [effects, responses] = await Promise.all([
    violationsInEffect(db, contestId),
    db.select().from(contestantResponse).where(inArray(contestantResponse.caseId, [...new Set(rows.map((r) => r.caseId))])).orderBy(asc(contestantResponse.createdAt)),
  ]);
  return rows.map((r) => ({
    ...r,
    inEffect: effects.get(`${viewer.userId}|${r.problemId}`)?.decisionId === r.decisionId,
    responses: responses.filter((x) => x.caseId === r.caseId).map(({ id, body, createdAt }) => ({ id, body, createdAt })),
  }));
}

/** The contestant answers a decision that took effect. Append-only; visible to reviewers. */
export async function submitResponse(db: Db, viewer: Principal, caseId: string, body: unknown, { now = new Date() }: Clock = {}) {
  const text = textSchema.parse(body);
  const c = await loadCase(db, caseId);
  if (c.userId !== viewer.userId) throw notFound("Case");
  const [confirmed] = await db
    .select({ id: decisionConfirmation.id })
    .from(decisionConfirmation)
    .innerJoin(reviewDecision, eq(reviewDecision.id, decisionConfirmation.decisionId))
    .where(and(eq(reviewDecision.caseId, caseId), eq(decisionConfirmation.verdict, "confirmed")))
    .limit(1);
  if (!confirmed) throw notFound("Case");
  await db.transaction(async (tx) => {
    await tx.insert(contestantResponse).values({ caseId, userId: viewer.userId, body: text, createdAt: now });
    await recordAudit(tx, { actorId: viewer.userId, action: "review.response.submit", targetType: "review_case", targetId: caseId });
  });
}

// ---------------------------------------------------------------- case page helpers

/** All submissions of the case subject, for the reviewer's history panel. */
export async function listSubjectSubmissions(db: Db, viewer: Principal, s: Subject) {
  assertReviewer(viewer);
  return db
    .select({
      id: submission.id,
      kind: submission.kind,
      createdAt: submission.createdAt,
      status: submission.status,
      verdict: submission.verdict,
      timeMs: submission.timeMs,
      memoryKb: submission.memoryKb,
      failedTest: submission.failedTest,
      compileOutput: submission.compileOutput,
      ideSessionId: submission.ideSessionId,
      ideSeq: submission.ideSeq,
      source: submission.source,
      sourceSha256: submission.sourceSha256,
    })
    .from(submission)
    .where(and(eq(submission.userId, s.userId), eq(submission.contestId, s.contestId), eq(submission.problemId, s.problemId)))
    .orderBy(asc(submission.createdAt));
}

/** Templates and snippets that applied to the subject (frozen at contest start / in effect at its end). */
export async function templatesInEffectFor(db: Db, viewer: Principal, s: Subject) {
  assertReviewer(viewer);
  const [c] = await db.select({ startsAt: contest.startsAt, endsAt: contest.endsAt }).from(contest).where(eq(contest.id, s.contestId));
  if (!c) throw notFound("Contest");
  const [personal, snippets] = await Promise.all([frozenTemplatesFor(db, s.userId, c.startsAt), snippetsInEffect(db, s.contestId, c.endsAt)]);
  return [...snippets, ...personal];
}
