import "server-only";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import { hasPermission } from "@/lib/auth/roles";
import { contestPhase } from "@/lib/contest-phase";
import { recordAudit } from "@/lib/server/audit";
import type { Db, Tx } from "@/lib/server/db";
import { isUniqueViolation } from "@/lib/server/db/errors";
import {
  contest,
  contestParticipant,
  contestProblem,
  problem,
  problemExample,
  problemTest,
  referenceSolution,
} from "@/lib/server/db/schema";
import { AppError, forbidden, notFound } from "@/lib/server/errors";
import { attachProblemSchema, contestInputSchema } from "@/lib/validation/contests";
import { isUuid } from "@/lib/validation/ids";
import { canManageContest, canManageProblem } from "./policy";
import type { Principal } from "./roles";

type Clock = { now?: Date };
type ContestRow = typeof contest.$inferSelect;

const conflict = (message: string) => new AppError("CONFLICT", message, 409);

async function lockManageableContest(tx: Tx, actor: Principal, contestId: string): Promise<ContestRow> {
  if (!isUuid(contestId)) throw notFound("Contest");
  if (!hasPermission(actor.roles, "contest:manage")) throw forbidden();
  const [row] = await tx.select().from(contest).where(eq(contest.id, contestId)).for("update");
  if (!row) throw notFound("Contest");
  if (!canManageContest(actor, row)) throw forbidden();
  return row;
}

/** The problem set is frozen once a published contest has started. */
function assertProblemSetEditable(c: ContestRow, now: Date) {
  if (c.status === "published" && now >= c.startsAt) throw conflict("The problem set is locked once the contest starts");
}

// ---------------------------------------------------------------- management

export async function createContest(db: Db, actor: Principal, raw: unknown): Promise<{ id: string }> {
  if (!hasPermission(actor.roles, "contest:manage")) throw forbidden();
  const input = contestInputSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(contest).values({ ...input, createdBy: actor.userId }).returning({ id: contest.id });
      await recordAudit(tx, { actorId: actor.userId, action: "contest.create", targetType: "contest", targetId: row!.id, metadata: { slug: input.slug } });
      return row!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("That slug is already in use");
    throw err;
  }
}

export async function updateContest(db: Db, actor: Principal, contestId: string, raw: unknown, { now = new Date() }: Clock = {}) {
  const input = contestInputSchema.parse(raw);
  try {
    await db.transaction(async (tx) => {
      const current = await lockManageableContest(tx, actor, contestId);
      const phase = contestPhase(current, now);
      if (phase === "running" || phase === "ended") {
        // Rewriting the window of a live or finished contest would invalidate standings.
        if (input.startsAt.getTime() !== current.startsAt.getTime()) throw conflict("Start time cannot change after the contest starts");
        if (input.endsAt < now) throw conflict("End time cannot be moved into the past");
      }
      if (phase === "upcoming" && input.startsAt <= now) throw conflict("A published contest must start in the future");
      await tx.update(contest).set(input).where(eq(contest.id, contestId));
      await recordAudit(tx, { actorId: actor.userId, action: "contest.update", targetType: "contest", targetId: contestId });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("That slug is already in use");
    throw err;
  }
}

export async function listManageableContests(db: Db, actor: Principal) {
  if (!hasPermission(actor.roles, "contest:manage")) throw forbidden();
  return db
    .select()
    .from(contest)
    .where(actor.roles.includes("admin") ? undefined : eq(contest.createdBy, actor.userId))
    .orderBy(desc(contest.startsAt));
}

async function contestProblems(db: Db | Tx, contestId: string) {
  return db
    .select({
      problemId: contestProblem.problemId,
      label: contestProblem.label,
      ordinal: contestProblem.ordinal,
      title: problem.title,
      slug: problem.slug,
      difficulty: problem.difficulty,
    })
    .from(contestProblem)
    .innerJoin(problem, eq(problem.id, contestProblem.problemId))
    .where(eq(contestProblem.contestId, contestId))
    .orderBy(asc(contestProblem.ordinal));
}

/** Reasons a contest cannot be published yet; empty when ready. */
export async function contestReadiness(db: Db | Tx, c: ContestRow, now: Date): Promise<string[]> {
  const issues: string[] = [];
  if (c.startsAt <= now) issues.push("Start time must be in the future");
  const problems = await contestProblems(db, c.id);
  if (problems.length === 0) issues.push("Add at least one problem");
  if (problems.length > 0) {
    const ids = problems.map((p) => p.problemId);
    const [withTests, withRefs] = await Promise.all([
      db.selectDistinct({ id: problemTest.problemId }).from(problemTest).where(inArray(problemTest.problemId, ids)),
      db.selectDistinct({ id: referenceSolution.problemId }).from(referenceSolution).where(inArray(referenceSolution.problemId, ids)),
    ]);
    const tested = new Set(withTests.map((r) => r.id));
    const solved = new Set(withRefs.map((r) => r.id));
    for (const p of problems) {
      if (!tested.has(p.problemId)) issues.push(`Problem ${p.label} has no hidden tests`);
      if (!solved.has(p.problemId)) issues.push(`Problem ${p.label} has no reference solution`);
    }
  }
  return issues;
}

export async function getContestForManagement(db: Db, actor: Principal, contestId: string, { now = new Date() }: Clock = {}) {
  if (!hasPermission(actor.roles, "contest:manage")) throw forbidden();
  if (!isUuid(contestId)) throw notFound("Contest");
  const [row] = await db.select().from(contest).where(eq(contest.id, contestId));
  if (!row) throw notFound("Contest");
  if (!canManageContest(actor, row)) throw forbidden();
  const [problems, readiness, participants] = await Promise.all([
    contestProblems(db, contestId),
    contestReadiness(db, row, now),
    db.$count(contestParticipant, eq(contestParticipant.contestId, contestId)),
  ]);
  return { ...row, phase: contestPhase(row, now), problems, readiness, participants };
}

export async function attachProblem(db: Db, actor: Principal, contestId: string, raw: unknown, { now = new Date() }: Clock = {}) {
  const input = attachProblemSchema.parse(raw);
  try {
    await db.transaction(async (tx) => {
      const c = await lockManageableContest(tx, actor, contestId);
      assertProblemSetEditable(c, now);
      const [p] = await tx.select({ id: problem.id, authorId: problem.authorId }).from(problem).where(eq(problem.id, input.problemId));
      if (!p) throw notFound("Problem");
      // Setters may only use problems they can manage (prevents leaking another setter's draft).
      if (!canManageProblem(actor, p)) throw forbidden();
      const [{ next }] = (await tx
        .select({ next: sql<number>`coalesce(${max(contestProblem.ordinal)}, 0)::int + 1` })
        .from(contestProblem)
        .where(eq(contestProblem.contestId, contestId))) as [{ next: number }];
      await tx.insert(contestProblem).values({ contestId, problemId: p.id, label: input.label, ordinal: next });
      await recordAudit(tx, { actorId: actor.userId, action: "contest.problem.attach", targetType: "contest", targetId: contestId, metadata: { problemId: p.id, label: input.label } });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("That problem or label is already in this contest");
    throw err;
  }
}

export async function detachProblem(db: Db, actor: Principal, contestId: string, problemId: string, { now = new Date() }: Clock = {}) {
  await db.transaction(async (tx) => {
    const c = await lockManageableContest(tx, actor, contestId);
    assertProblemSetEditable(c, now);
    if (!isUuid(problemId)) throw notFound("Contest problem");
    const deleted = await tx
      .delete(contestProblem)
      .where(and(eq(contestProblem.contestId, contestId), eq(contestProblem.problemId, problemId)))
      .returning({ label: contestProblem.label });
    if (deleted.length === 0) throw notFound("Contest problem");
    await recordAudit(tx, { actorId: actor.userId, action: "contest.problem.detach", targetType: "contest", targetId: contestId, metadata: { problemId, label: deleted[0]!.label } });
  });
}

export async function publishContest(db: Db, actor: Principal, contestId: string, { now = new Date() }: Clock = {}) {
  await db.transaction(async (tx) => {
    const c = await lockManageableContest(tx, actor, contestId);
    if (c.status === "published") return;
    const issues = await contestReadiness(tx, c, now);
    if (issues.length > 0) throw new AppError("INVALID_INPUT", `Not ready to publish: ${issues.join("; ")}`, 400);
    await tx.update(contest).set({ status: "published", publishedAt: now }).where(eq(contest.id, contestId));
    await recordAudit(tx, { actorId: actor.userId, action: "contest.publish", targetType: "contest", targetId: contestId });
  });
}

export async function unpublishContest(db: Db, actor: Principal, contestId: string, { now = new Date() }: Clock = {}) {
  await db.transaction(async (tx) => {
    const c = await lockManageableContest(tx, actor, contestId);
    if (c.status === "draft") return;
    if (now >= c.startsAt) throw conflict("A contest cannot be unpublished after it starts");
    await tx.update(contest).set({ status: "draft", publishedAt: null }).where(eq(contest.id, contestId));
    await recordAudit(tx, { actorId: actor.userId, action: "contest.unpublish", targetType: "contest", targetId: contestId });
  });
}

// ---------------------------------------------------------------- contestants

export async function listPublicContests(db: Db, { now = new Date() }: Clock = {}) {
  const rows = await db
    .select({ id: contest.id, slug: contest.slug, title: contest.title, startsAt: contest.startsAt, endsAt: contest.endsAt, status: contest.status })
    .from(contest)
    .where(eq(contest.status, "published"))
    .orderBy(desc(contest.startsAt))
    .limit(100);
  return rows.map(({ status, ...c }) => ({ ...c, phase: contestPhase({ status, ...c }, now) }));
}

/**
 * Contest page for any viewer. Drafts are invisible to non-managers, and the
 * problem list is withheld until the contest starts.
 */
export async function getContestForViewer(db: Db, viewer: Principal | null, slug: string, { now = new Date() }: Clock = {}) {
  const [row] = await db.select().from(contest).where(eq(contest.slug, slug));
  const isManager = !!row && !!viewer && canManageContest(viewer, row);
  if (!row || (row.status !== "published" && !isManager)) throw notFound("Contest");

  const phase = contestPhase(row, now);
  const problemsVisible = isManager || phase === "running" || phase === "ended";
  const [problems, registration] = await Promise.all([
    problemsVisible ? contestProblems(db, row.id) : Promise.resolve([]),
    viewer
      ? db
          .select({ at: contestParticipant.registeredAt })
          .from(contestParticipant)
          .where(and(eq(contestParticipant.contestId, row.id), eq(contestParticipant.userId, viewer.userId)))
      : Promise.resolve([]),
  ]);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    phase,
    isManager,
    problemsVisible,
    problems: problems.map(({ label, title, difficulty }) => ({ label, title, difficulty })),
    isRegistered: registration.length > 0,
    canRegister: !!viewer && row.status === "published" && now < row.endsAt && registration.length === 0,
  };
}

/** Contestant-facing statement. Selects public columns only: never tests, reference solutions or setter notes. */
export async function getContestProblemForViewer(
  db: Db,
  viewer: Principal | null,
  contestSlug: string,
  label: string,
  clock: Clock = {},
) {
  const c = await getContestForViewer(db, viewer, contestSlug, clock);
  if (!c.problemsVisible) throw notFound("Problem");
  const [row] = await db
    .select({
      id: problem.id,
      label: contestProblem.label,
      title: problem.title,
      statement: problem.statement,
      inputFormat: problem.inputFormat,
      outputFormat: problem.outputFormat,
      constraints: problem.constraints,
      notes: problem.notes,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
    })
    .from(contestProblem)
    .innerJoin(problem, eq(problem.id, contestProblem.problemId))
    .where(and(eq(contestProblem.contestId, c.id), eq(contestProblem.label, label.toUpperCase())));
  if (!row) throw notFound("Problem");
  const examples = await db
    .select({ ordinal: problemExample.ordinal, input: problemExample.input, output: problemExample.output, explanation: problemExample.explanation })
    .from(problemExample)
    .where(eq(problemExample.problemId, row.id))
    .orderBy(asc(problemExample.ordinal));
  return { contest: { slug: c.slug, title: c.title, phase: c.phase, isRegistered: c.isRegistered }, problem: row, examples };
}

export async function registerForContest(db: Db, viewer: Principal, contestId: string, { now = new Date() }: Clock = {}) {
  if (!isUuid(contestId)) throw notFound("Contest");
  const [row] = await db.select().from(contest).where(eq(contest.id, contestId));
  if (!row || row.status !== "published") throw notFound("Contest");
  if (now >= row.endsAt) throw conflict("Registration has closed");
  await db.insert(contestParticipant).values({ contestId, userId: viewer.userId }).onConflictDoNothing();
}
