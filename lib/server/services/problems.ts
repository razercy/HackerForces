import "server-only";
import { and, asc, count, desc, eq, max, sql } from "drizzle-orm";
import { hasPermission } from "@/lib/auth/roles";
import type { Language } from "@/lib/languages";
import { recordAudit } from "@/lib/server/audit";
import type { Db, Tx } from "@/lib/server/db";
import { isUniqueViolation } from "@/lib/server/db/errors";
import { problem, problemExample, problemTest, referenceSolution } from "@/lib/server/db/schema";
import { AppError, forbidden, notFound } from "@/lib/server/errors";
import {
  exampleInputSchema,
  problemInputSchema,
  referenceSolutionInputSchema,
  testInputSchema,
} from "@/lib/validation/problems";
import { isUuid } from "@/lib/validation/ids";
import { canManageProblem } from "./policy";
import type { Principal } from "./roles";

const PREVIEW_CHARS = 200;

const slugTaken = () => new AppError("CONFLICT", "That slug is already in use", 409);

/**
 * Loads a problem the actor may manage, locking the row so that concurrent
 * edits to its examples/tests serialise (ordinal assignment relies on this).
 */
async function lockManageableProblem(tx: Tx, actor: Principal, problemId: string) {
  if (!isUuid(problemId)) throw notFound("Problem");
  if (!hasPermission(actor.roles, "problem:manage")) throw forbidden();
  const [row] = await tx
    .select({ id: problem.id, authorId: problem.authorId })
    .from(problem)
    .where(eq(problem.id, problemId))
    .for("update");
  if (!row) throw notFound("Problem");
  if (!canManageProblem(actor, row)) throw forbidden();
  return row;
}

export async function createProblem(db: Db, actor: Principal, raw: unknown): Promise<{ id: string }> {
  if (!hasPermission(actor.roles, "problem:manage")) throw forbidden();
  const input = problemInputSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(problem)
        .values({ ...input, authorId: actor.userId })
        .returning({ id: problem.id });
      await recordAudit(tx, { actorId: actor.userId, action: "problem.create", targetType: "problem", targetId: row!.id, metadata: { slug: input.slug } });
      return row!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw slugTaken();
    throw err;
  }
}

export async function updateProblem(db: Db, actor: Principal, problemId: string, raw: unknown): Promise<void> {
  const input = problemInputSchema.parse(raw);
  try {
    await db.transaction(async (tx) => {
      await lockManageableProblem(tx, actor, problemId);
      await tx.update(problem).set(input).where(eq(problem.id, problemId));
      await recordAudit(tx, { actorId: actor.userId, action: "problem.update", targetType: "problem", targetId: problemId });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw slugTaken();
    throw err;
  }
}

export async function listManageableProblems(db: Db, actor: Principal) {
  if (!hasPermission(actor.roles, "problem:manage")) throw forbidden();
  const testCount = db
    .select({ problemId: problemTest.problemId, n: count().as("n") })
    .from(problemTest)
    .groupBy(problemTest.problemId)
    .as("test_count");
  const rows = await db
    .select({
      id: problem.id,
      slug: problem.slug,
      title: problem.title,
      difficulty: problem.difficulty,
      authorId: problem.authorId,
      updatedAt: problem.updatedAt,
      testCount: sql<number>`coalesce(${testCount.n}, 0)::int`,
    })
    .from(problem)
    .leftJoin(testCount, eq(testCount.problemId, problem.id))
    .where(actor.roles.includes("admin") ? undefined : eq(problem.authorId, actor.userId))
    .orderBy(desc(problem.updatedAt));
  return rows;
}

/** Full problem for its manager, including hidden data. Test bodies are previewed, not returned in full. */
export async function getProblemForManagement(db: Db, actor: Principal, problemId: string) {
  if (!hasPermission(actor.roles, "problem:manage")) throw forbidden();
  if (!isUuid(problemId)) throw notFound("Problem");
  const [row] = await db.select().from(problem).where(eq(problem.id, problemId));
  if (!row) throw notFound("Problem");
  if (!canManageProblem(actor, row)) throw forbidden();

  const [examples, tests, solutions] = await Promise.all([
    db.select().from(problemExample).where(eq(problemExample.problemId, problemId)).orderBy(asc(problemExample.ordinal)),
    db
      .select({
        id: problemTest.id,
        ordinal: problemTest.ordinal,
        inputBytes: sql<number>`octet_length(${problemTest.input})`,
        outputBytes: sql<number>`octet_length(${problemTest.expectedOutput})`,
        inputPreview: sql<string>`left(${problemTest.input}, ${PREVIEW_CHARS})`,
        outputPreview: sql<string>`left(${problemTest.expectedOutput}, ${PREVIEW_CHARS})`,
      })
      .from(problemTest)
      .where(eq(problemTest.problemId, problemId))
      .orderBy(asc(problemTest.ordinal)),
    db.select().from(referenceSolution).where(eq(referenceSolution.problemId, problemId)),
  ]);
  return { ...row, examples, tests, referenceSolutions: solutions };
}

export async function addExample(db: Db, actor: Principal, problemId: string, raw: unknown): Promise<void> {
  const input = exampleInputSchema.parse(raw);
  await db.transaction(async (tx) => {
    await lockManageableProblem(tx, actor, problemId);
    const [{ next }] = (await tx
      .select({ next: sql<number>`coalesce(${max(problemExample.ordinal)}, 0)::int + 1` })
      .from(problemExample)
      .where(eq(problemExample.problemId, problemId))) as [{ next: number }];
    await tx.insert(problemExample).values({ ...input, problemId, ordinal: next });
  });
}

export async function deleteExample(db: Db, actor: Principal, problemId: string, exampleId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockManageableProblem(tx, actor, problemId);
    if (!isUuid(exampleId)) throw notFound("Example");
    await tx.delete(problemExample).where(and(eq(problemExample.id, exampleId), eq(problemExample.problemId, problemId)));
  });
}

export async function addTest(db: Db, actor: Principal, problemId: string, raw: unknown): Promise<{ ordinal: number }> {
  const input = testInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    await lockManageableProblem(tx, actor, problemId);
    const [{ next }] = (await tx
      .select({ next: sql<number>`coalesce(${max(problemTest.ordinal)}, 0)::int + 1` })
      .from(problemTest)
      .where(eq(problemTest.problemId, problemId))) as [{ next: number }];
    await tx.insert(problemTest).values({ ...input, problemId, ordinal: next });
    await recordAudit(tx, { actorId: actor.userId, action: "problem.test.add", targetType: "problem", targetId: problemId, metadata: { ordinal: next } });
    return { ordinal: next };
  });
}

export async function deleteTest(db: Db, actor: Principal, problemId: string, testId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockManageableProblem(tx, actor, problemId);
    if (!isUuid(testId)) throw notFound("Test");
    const deleted = await tx
      .delete(problemTest)
      .where(and(eq(problemTest.id, testId), eq(problemTest.problemId, problemId)))
      .returning({ ordinal: problemTest.ordinal });
    if (deleted.length === 0) throw notFound("Test");
    await recordAudit(tx, { actorId: actor.userId, action: "problem.test.delete", targetType: "problem", targetId: problemId, metadata: { ordinal: deleted[0]!.ordinal } });
  });
}

export async function setReferenceSolution(db: Db, actor: Principal, problemId: string, raw: unknown): Promise<void> {
  const input = referenceSolutionInputSchema.parse(raw);
  await db.transaction(async (tx) => {
    await lockManageableProblem(tx, actor, problemId);
    await tx
      .insert(referenceSolution)
      .values({ problemId, language: input.language, source: input.source, authorId: actor.userId })
      .onConflictDoUpdate({
        target: [referenceSolution.problemId, referenceSolution.language],
        set: { source: input.source, authorId: actor.userId, updatedAt: new Date() },
      });
    await recordAudit(tx, { actorId: actor.userId, action: "problem.reference.set", targetType: "problem", targetId: problemId, metadata: { language: input.language satisfies Language } });
  });
}
