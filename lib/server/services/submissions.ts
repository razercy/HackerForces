import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { hasPermission } from "@/lib/auth/roles";
import { contestPhase } from "@/lib/contest-phase";
import type { Db } from "@/lib/server/db";
import { contest, contestParticipant, contestProblem, ideSession, judgeJob, problem, submission, user } from "@/lib/server/db/schema";
import { AppError, notFound } from "@/lib/server/errors";
import { isUuid } from "@/lib/validation/ids";
import { submissionInputSchema } from "@/lib/validation/submissions";
import type { Verdict } from "@/lib/submissions";
import { hasCurrentAcknowledgement } from "./acknowledgements";
import { violationsInEffect } from "@/lib/server/review/cases";
import { canManageContest } from "./policy";
import type { Principal } from "./roles";

type Clock = { now?: Date };

/** Per-user throttles, enforced while holding the participant row lock. */
export const SUBMIT_COOLDOWN_MS = 5_000;
export const MAX_PENDING_PER_USER = 3;
/** ICPC-style penalty per rejected attempt before the first accept. */
export const PENALTY_MINUTES = 20;

const conflict = (message: string) => new AppError("CONFLICT", message, 409);
const rateLimited = (message: string) => new AppError("RATE_LIMITED", message, 429);

export const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Stores an immutable snapshot of the submitted source and enqueues a judge
 * job in the same transaction, so a submission can never exist without a job.
 */
export async function createSubmission(db: Db, viewer: Principal, contestSlug: string, raw: unknown, { now = new Date() }: Clock = {}) {
  const input = submissionInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(contest).where(eq(contest.slug, contestSlug));
    if (!c || c.status !== "published") throw notFound("Contest");
    const phase = contestPhase(c, now);
    if (phase === "upcoming") throw conflict("The contest has not started yet");
    if (phase === "ended") throw conflict("The contest has ended");

    // Locking the participant row serialises one user's submissions, which
    // makes the throttle checks below race-free.
    const [participant] = await tx
      .select({ userId: contestParticipant.userId })
      .from(contestParticipant)
      .where(and(eq(contestParticipant.contestId, c.id), eq(contestParticipant.userId, viewer.userId)))
      .for("update");
    if (!participant) throw new AppError("FORBIDDEN", "Register for the contest before submitting", 403);
    if (!(await hasCurrentAcknowledgement(tx, viewer.userId, c.id))) {
      throw new AppError("FORBIDDEN", "Accept the activity-recording notice for this contest first", 403);
    }

    const [p] = await tx
      .select({ id: contestProblem.problemId })
      .from(contestProblem)
      .where(and(eq(contestProblem.contestId, c.id), eq(contestProblem.label, input.label)));
    if (!p) throw notFound("Problem");

    // A submission may come without an editor session (e.g. a direct API call); that is
    // recorded as missing telemetry, not blocked. A session that is supplied must match.
    if (input.ideSessionId) {
      const [sess] = await tx
        .select({ userId: ideSession.userId, contestId: ideSession.contestId, problemId: ideSession.problemId })
        .from(ideSession)
        .where(eq(ideSession.id, input.ideSessionId));
      if (!sess || sess.userId !== viewer.userId || sess.contestId !== c.id || sess.problemId !== p.id) {
        throw new AppError("INVALID_INPUT", "Editor session does not match this submission", 400);
      }
    }

    const recent = await tx
      .select({ createdAt: submission.createdAt, status: submission.status })
      .from(submission)
      .where(and(eq(submission.contestId, c.id), eq(submission.userId, viewer.userId), gte(submission.createdAt, new Date(now.getTime() - 10 * 60_000))))
      .orderBy(desc(submission.createdAt));
    const last = recent[0];
    if (last && now.getTime() - last.createdAt.getTime() < SUBMIT_COOLDOWN_MS) throw rateLimited("Please wait a few seconds between submissions");
    if (recent.filter((r) => r.status === "queued" || r.status === "running").length >= MAX_PENDING_PER_USER) {
      throw rateLimited("Wait for your pending submissions to be judged");
    }

    const [row] = await tx
      .insert(submission)
      .values({
        contestId: c.id,
        problemId: p.id,
        userId: viewer.userId,
        kind: input.kind,
        language: input.language,
        source: input.source,
        sourceSha256: sha256Hex(input.source),
        createdAt: now,
        ideSessionId: input.ideSessionId ?? null,
        ideSeq: input.ideSessionId ? (input.ideSeq ?? null) : null,
      })
      .returning({ id: submission.id });
    await tx.insert(judgeJob).values({ submissionId: row!.id, availableAt: now });
    return { id: row!.id };
  });
}

/** Owners, contest managers and integrity reviewers may view a submission; everyone else gets 404. */
export async function getSubmissionForViewer(db: Db, viewer: Principal, submissionId: string) {
  if (!isUuid(submissionId)) throw notFound("Submission");
  const [row] = await db
    .select({
      submission,
      label: contestProblem.label,
      problemTitle: problem.title,
      contestSlug: contest.slug,
      contestTitle: contest.title,
      contestCreatedBy: contest.createdBy,
      authorName: user.name,
    })
    .from(submission)
    .innerJoin(contest, eq(contest.id, submission.contestId))
    .innerJoin(problem, eq(problem.id, submission.problemId))
    .innerJoin(user, eq(user.id, submission.userId))
    .leftJoin(contestProblem, and(eq(contestProblem.contestId, submission.contestId), eq(contestProblem.problemId, submission.problemId)))
    .where(eq(submission.id, submissionId));
  if (!row) throw notFound("Submission");
  const allowed =
    row.submission.userId === viewer.userId ||
    canManageContest(viewer, { createdBy: row.contestCreatedBy }) ||
    hasPermission(viewer.roles, "integrity:review");
  if (!allowed) throw notFound("Submission");

  const s = row.submission;
  return {
    id: s.id,
    kind: s.kind,
    language: s.language,
    source: s.source,
    sourceSha256: s.sourceSha256,
    createdAt: s.createdAt,
    status: s.status,
    verdict: s.verdict,
    timeMs: s.timeMs,
    memoryKb: s.memoryKb,
    passedTests: s.passedTests,
    totalTests: s.totalTests,
    failedTest: s.failedTest,
    compileOutput: s.compileOutput,
    judgedAt: s.judgedAt,
    label: row.label,
    problemTitle: row.problemTitle,
    contestSlug: row.contestSlug,
    contestTitle: row.contestTitle,
    authorName: row.authorName,
    isOwner: s.userId === viewer.userId,
  };
}

/** The viewer's own submissions in a contest, newest first. Never includes source. */
export async function listOwnSubmissions(db: Db, viewer: Principal, contestSlug: string, { label, limit = 50 }: { label?: string; limit?: number } = {}) {
  const [c] = await db.select({ id: contest.id }).from(contest).where(eq(contest.slug, contestSlug));
  if (!c) throw notFound("Contest");
  return db
    .select({
      id: submission.id,
      label: contestProblem.label,
      kind: submission.kind,
      createdAt: submission.createdAt,
      status: submission.status,
      verdict: submission.verdict,
      timeMs: submission.timeMs,
      memoryKb: submission.memoryKb,
      failedTest: submission.failedTest,
    })
    .from(submission)
    .innerJoin(contestProblem, and(eq(contestProblem.contestId, submission.contestId), eq(contestProblem.problemId, submission.problemId)))
    .where(
      and(
        eq(submission.contestId, c.id),
        eq(submission.userId, viewer.userId),
        label ? eq(contestProblem.label, label.toUpperCase()) : undefined,
      ),
    )
    .orderBy(desc(submission.createdAt))
    .limit(Math.min(limit, 200));
}

// ---------------------------------------------------------------- standings

export type StandingsCell = { solved: boolean; rejected: number; solvedAtMinute: number | null; pending: boolean; excluded: boolean };
export type StandingsRow = { rank: number; userId: string; name: string; solved: number; penalty: number; cells: Record<string, StandingsCell>; hasExclusion: boolean };

/** Verdicts that do not cost penalty (the program never ran). */
const NO_PENALTY: ReadonlySet<Verdict> = new Set(["compilation_error"]);

/**
 * ICPC-style standings: solved count desc, then penalty asc, where penalty =
 * minutes from start to first accept + 20 per earlier rejected attempt.
 * Only `submission`-kind entries made inside the contest window count.
 */
export async function getStandings(db: Db, viewer: Principal | null, contestSlug: string, { now = new Date() }: Clock = {}) {
  const [c] = await db.select().from(contest).where(eq(contest.slug, contestSlug));
  const isManager = !!c && !!viewer && canManageContest(viewer, c);
  if (!c || (c.status !== "published" && !isManager)) throw notFound("Contest");
  const phase = contestPhase(c, now);
  const problems = await db
    .select({ problemId: contestProblem.problemId, label: contestProblem.label })
    .from(contestProblem)
    .where(eq(contestProblem.contestId, c.id))
    .orderBy(asc(contestProblem.ordinal));
  const contestInfo = { slug: c.slug, title: c.title, phase, labels: problems.map((p) => p.label) };
  if (phase === "upcoming" || phase === "draft") return { contest: contestInfo, rows: [] as StandingsRow[] };

  const [participants, subs, violations] = await Promise.all([
    db
      .select({ userId: contestParticipant.userId, name: user.name })
      .from(contestParticipant)
      .innerJoin(user, eq(user.id, contestParticipant.userId))
      .where(eq(contestParticipant.contestId, c.id)),
    db
      .select({ userId: submission.userId, problemId: submission.problemId, createdAt: submission.createdAt, status: submission.status, verdict: submission.verdict })
      .from(submission)
      .where(
        and(
          eq(submission.contestId, c.id),
          eq(submission.kind, "submission"),
          gte(submission.createdAt, c.startsAt),
          lt(submission.createdAt, c.endsAt),
          inArray(submission.status, ["queued", "running", "judged"]),
        ),
      )
      .orderBy(asc(submission.createdAt)),
    violationsInEffect(db, c.id),
  ]);

  const labelOf = new Map(problems.map((p) => [p.problemId, p.label]));
  const rows = new Map<string, StandingsRow>(
    participants.map((p) => [p.userId, { rank: 0, userId: p.userId, name: p.name, solved: 0, penalty: 0, cells: {}, hasExclusion: false }]),
  );
  for (const s of subs) {
    const row = rows.get(s.userId);
    const label = labelOf.get(s.problemId);
    if (!row || !label) continue;
    const cell = (row.cells[label] ??= { solved: false, rejected: 0, solvedAtMinute: null, pending: false, excluded: false });
    // A confirmed, second-person-approved violation excludes the problem for this contestant.
    if (violations.has(`${s.userId}|${s.problemId}`)) {
      cell.excluded = true;
      row.hasExclusion = true;
      continue;
    }
    if (cell.solved) continue; // Attempts after the first accept do not matter.
    if (s.status !== "judged") {
      cell.pending = true;
      continue;
    }
    if (s.verdict === "accepted") {
      cell.solved = true;
      cell.solvedAtMinute = Math.floor((s.createdAt.getTime() - c.startsAt.getTime()) / 60_000);
      row.solved += 1;
      row.penalty += cell.solvedAtMinute + PENALTY_MINUTES * cell.rejected;
    } else if (s.verdict && !NO_PENALTY.has(s.verdict)) {
      cell.rejected += 1;
    }
  }

  const sorted = [...rows.values()].sort((a, b) => b.solved - a.solved || a.penalty - b.penalty || a.name.localeCompare(b.name));
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    r.rank = prev && prev.solved === r.solved && prev.penalty === r.penalty ? prev.rank : i + 1;
  });
  return { contest: contestInfo, rows: sorted };
}
