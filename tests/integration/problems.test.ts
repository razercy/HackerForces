import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/server/db";
import { auditLog, problemTest } from "@/lib/server/db/schema";
import {
  addExample,
  addTest,
  createProblem,
  deleteTest,
  getProblemForManagement,
  listManageableProblems,
  setReferenceSolution,
  updateProblem,
} from "@/lib/server/services/problems";
import type { Principal } from "@/lib/server/services/roles";
import { createTestDb } from "../helpers/db";
import { principal, problemInput } from "../helpers/fixtures";

let db: Db;
let close: () => Promise<void>;
let admin: Principal, setter: Principal, otherSetter: Principal, reviewer: Principal, contestant: Principal;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  [admin, setter, otherSetter, reviewer, contestant] = await Promise.all([
    principal(db, "admin"),
    principal(db, "problem_setter"),
    principal(db, "problem_setter"),
    principal(db, "reviewer"),
    principal(db),
  ]);
});
afterAll(async () => close());

describe("problem management authorization", () => {
  it("setters and admins can create problems; reviewers and contestants cannot", async () => {
    await expect(createProblem(db, setter, problemInput())).resolves.toHaveProperty("id");
    await expect(createProblem(db, admin, problemInput())).resolves.toHaveProperty("id");
    await expect(createProblem(db, reviewer, problemInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createProblem(db, contestant, problemInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a setter cannot read or edit another setter's problem; an admin can", async () => {
    const { id } = await createProblem(db, setter, problemInput());
    await expect(getProblemForManagement(db, otherSetter, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateProblem(db, otherSetter, id, problemInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(addTest(db, otherSetter, id, { input: "1 2\n", expectedOutput: "3\n" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getProblemForManagement(db, admin, id)).resolves.toMatchObject({ id });
  });

  it("a reviewer cannot read hidden problem data", async () => {
    const { id } = await createProblem(db, setter, problemInput());
    await expect(getProblemForManagement(db, reviewer, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists only the setter's own problems, but everything for admins", async () => {
    const mine = await createProblem(db, otherSetter, problemInput());
    const ids = (await listManageableProblems(db, otherSetter)).map((p) => p.id);
    expect(ids).toContain(mine.id);
    expect((await listManageableProblems(db, otherSetter)).every((p) => p.authorId === otherSetter.userId)).toBe(true);
    expect((await listManageableProblems(db, admin)).map((p) => p.id)).toContain(mine.id);
  });

  it("returns 404 for unknown problems", async () => {
    await expect(getProblemForManagement(db, admin, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("problem validation", () => {
  it("rejects bad slugs, limits and unknown fields", async () => {
    await expect(createProblem(db, setter, problemInput({ slug: "Bad Slug!" }))).rejects.toBeInstanceOf(ZodError);
    await expect(createProblem(db, setter, problemInput({ timeLimitMs: 50 }))).rejects.toBeInstanceOf(ZodError);
    await expect(createProblem(db, setter, problemInput({ memoryLimitMb: 4096 }))).rejects.toBeInstanceOf(ZodError);
    await expect(createProblem(db, setter, problemInput({ difficulty: 850 }))).rejects.toBeInstanceOf(ZodError);
    await expect(createProblem(db, setter, problemInput({ authorId: admin.userId }))).rejects.toBeInstanceOf(ZodError);
  });

  it("reports a duplicate slug as a conflict", async () => {
    const input = problemInput();
    await createProblem(db, setter, input);
    await expect(createProblem(db, setter, { ...input })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("rejects hidden tests over the size limit (validation and DB constraint)", async () => {
    const { id } = await createProblem(db, setter, problemInput());
    const huge = "9".repeat(256 * 1024 + 1);
    await expect(addTest(db, setter, id, { input: huge, expectedOutput: "1" })).rejects.toBeInstanceOf(ZodError);
    // Bypass the service to prove the database also enforces it.
    await expect(db.insert(problemTest).values({ problemId: id, ordinal: 99, input: huge, expectedOutput: "1" })).rejects.toThrow();
  });
});

describe("tests, examples and reference solutions", () => {
  it("assigns ordinals sequentially, normalises CRLF, and previews rather than returns test bodies", async () => {
    const { id } = await createProblem(db, setter, problemInput());
    await addTest(db, setter, id, { input: "1 2\r\n", expectedOutput: "3\r\n" });
    const big = "x".repeat(5000);
    await addTest(db, setter, id, { input: big, expectedOutput: "ok" });
    await addExample(db, setter, id, { input: "1 2", output: "3" });

    const p = await getProblemForManagement(db, setter, id);
    expect(p.tests.map((t) => t.ordinal)).toEqual([1, 2]);
    expect(p.tests[0]).toMatchObject({ inputPreview: "1 2\n", outputPreview: "3\n", inputBytes: 4 });
    expect(p.tests[1]!.inputPreview).toHaveLength(200);
    expect(p.tests[1]!.inputBytes).toBe(5000);
    expect(p.examples).toHaveLength(1);
  });

  it("deleting a test only affects the named problem and is audited", async () => {
    const a = await createProblem(db, setter, problemInput());
    const b = await createProblem(db, setter, problemInput());
    await addTest(db, setter, b.id, { input: "1", expectedOutput: "1" });
    const [bTest] = await db.select().from(problemTest).where(eq(problemTest.problemId, b.id));
    // Wrong problem id for that test → not found, nothing deleted.
    await expect(deleteTest(db, setter, a.id, bTest!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deleteTest(db, setter, b.id, bTest!.id);
    const actions = (await db.select().from(auditLog).where(eq(auditLog.targetId, b.id))).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["problem.create", "problem.test.add", "problem.test.delete"]));
  });

  it("upserts one reference solution per language", async () => {
    const { id } = await createProblem(db, setter, problemInput());
    await setReferenceSolution(db, setter, id, { language: "cpp17", source: "int main(){}" });
    await setReferenceSolution(db, setter, id, { language: "cpp17", source: "int main(){return 0;}" });
    const p = await getProblemForManagement(db, setter, id);
    expect(p.referenceSolutions).toHaveLength(1);
    expect(p.referenceSolutions[0]!.source).toBe("int main(){return 0;}");
    await expect(setReferenceSolution(db, setter, id, { language: "python3", source: "print()" })).rejects.toBeInstanceOf(ZodError);
  });
});
