import { ZodError } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/server/db";
import {
  attachProblem,
  createContest,
  detachProblem,
  getContestForManagement,
  getContestForViewer,
  getContestProblemForViewer,
  listPublicContests,
  publishContest,
  registerForContest,
  unpublishContest,
  updateContest,
} from "@/lib/server/services/contests";
import { addExample, addTest, createProblem, setReferenceSolution } from "@/lib/server/services/problems";
import type { Principal } from "@/lib/server/services/roles";
import { ACK } from "../helpers/contest-fixture";
import { createTestDb } from "../helpers/db";
import { HOUR, contestInput, principal, problemInput } from "../helpers/fixtures";

let db: Db;
let close: () => Promise<void>;
let admin: Principal, setter: Principal, otherSetter: Principal, reviewer: Principal, contestant: Principal;

const T0 = new Date("2030-01-01T10:00:00Z");
const at = (h: number) => new Date(T0.getTime() + h * HOUR);

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

async function readyProblem(owner: Principal) {
  const { id } = await createProblem(db, owner, problemInput());
  await addTest(db, owner, id, { input: "SECRET-INPUT 1 2\n", expectedOutput: "3\n" });
  await addExample(db, owner, id, { input: "1 2\n", output: "3\n" });
  await setReferenceSolution(db, owner, id, { language: "cpp17", source: "// SECRET-REFERENCE\nint main(){}" });
  return id;
}

/** A published contest running from T0+1h to T0+3h, created at T0. */
async function publishedContest(owner: Principal) {
  const { id } = await createContest(db, owner, contestInput(at(1), at(3)));
  const problemId = await readyProblem(owner);
  await attachProblem(db, owner, id, { problemId, label: "a" }, { now: T0 });
  await publishContest(db, owner, id, { now: T0 });
  const c = await getContestForManagement(db, owner, id, { now: T0 });
  return { id, slug: c.slug, problemId };
}

describe("contest management", () => {
  it("only setters/admins create contests, and the window is validated", async () => {
    await expect(createContest(db, reviewer, contestInput(at(1), at(2)))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createContest(db, contestant, contestInput(at(1), at(2)))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createContest(db, setter, contestInput(at(2), at(1)))).rejects.toBeInstanceOf(ZodError);
    await expect(createContest(db, setter, contestInput(at(1), at(1 + 24 * 15)))).rejects.toBeInstanceOf(ZodError);
    await expect(createContest(db, setter, { ...contestInput(at(1), at(2)), startsAt: "2030-01-01T11:00:00" })).rejects.toBeInstanceOf(ZodError);
  });

  it("a setter cannot attach another setter's problem or manage their contest", async () => {
    const { id } = await createContest(db, setter, contestInput(at(1), at(2)));
    const foreign = await readyProblem(otherSetter);
    await expect(attachProblem(db, setter, id, { problemId: foreign, label: "A" }, { now: T0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getContestForManagement(db, otherSetter, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(publishContest(db, otherSetter, id, { now: T0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Admins can attach any problem to any contest.
    await expect(attachProblem(db, admin, id, { problemId: foreign, label: "A" }, { now: T0 })).resolves.toBeUndefined();
  });

  it("rejects duplicate labels or problems within a contest", async () => {
    const { id } = await createContest(db, setter, contestInput(at(1), at(2)));
    const p1 = await readyProblem(setter);
    const p2 = await readyProblem(setter);
    await attachProblem(db, setter, id, { problemId: p1, label: "A" }, { now: T0 });
    await expect(attachProblem(db, setter, id, { problemId: p2, label: "a" }, { now: T0 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(attachProblem(db, setter, id, { problemId: p1, label: "B" }, { now: T0 })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("publishing requires problems with hidden tests and reference solutions, and a future start", async () => {
    const { id } = await createContest(db, setter, contestInput(at(1), at(2)));
    await expect(publishContest(db, setter, id, { now: T0 })).rejects.toThrow(/at least one problem/);

    const { id: bare } = await createProblem(db, setter, problemInput());
    await attachProblem(db, setter, id, { problemId: bare, label: "A" }, { now: T0 });
    const m = await getContestForManagement(db, setter, id, { now: T0 });
    expect(m.readiness).toEqual(["Problem A has no hidden tests", "Problem A has no reference solution"]);

    await addTest(db, setter, bare, { input: "1", expectedOutput: "1" });
    await setReferenceSolution(db, setter, bare, { language: "cpp17", source: "int main(){}" });
    await expect(publishContest(db, setter, id, { now: at(1.5) })).rejects.toThrow(/future/);
    await publishContest(db, setter, id, { now: T0 });
    expect((await getContestForManagement(db, setter, id, { now: T0 })).phase).toBe("upcoming");
  });

  it("locks the problem set and start time once the contest starts", async () => {
    const { id, problemId } = await publishedContest(setter);
    const extra = await readyProblem(setter);
    await expect(attachProblem(db, setter, id, { problemId: extra, label: "B" }, { now: at(2) })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(detachProblem(db, setter, id, problemId, { now: at(2) })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(unpublishContest(db, setter, id, { now: at(2) })).rejects.toMatchObject({ code: "CONFLICT" });

    const m = await getContestForManagement(db, setter, id, { now: at(2) });
    const base = { slug: m.slug, title: "Renamed", description: "", endsAt: at(4).toISOString() };
    await expect(updateContest(db, setter, id, { ...base, startsAt: at(1.5).toISOString() }, { now: at(2) })).rejects.toMatchObject({ code: "CONFLICT" });
    // Extending the end time of a running contest is allowed.
    await updateContest(db, setter, id, { ...base, startsAt: at(1).toISOString() }, { now: at(2) });
    expect((await getContestForManagement(db, setter, id, { now: at(2) })).title).toBe("Renamed");
  });

  it("can be unpublished before it starts", async () => {
    const { id, slug } = await publishedContest(setter);
    await unpublishContest(db, setter, id, { now: T0 });
    await expect(getContestForViewer(db, contestant, slug, { now: T0 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("contestant visibility", () => {
  it("draft contests are invisible to contestants but visible to their manager", async () => {
    const { id } = await createContest(db, setter, contestInput(at(1), at(2)));
    const m = await getContestForManagement(db, setter, id, { now: T0 });
    await expect(getContestForViewer(db, contestant, m.slug, { now: T0 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getContestForViewer(db, null, m.slug, { now: T0 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getContestForViewer(db, setter, m.slug, { now: T0 })).resolves.toMatchObject({ isManager: true });
    expect((await listPublicContests(db, { now: T0 })).map((c) => c.id)).not.toContain(id);
  });

  it("problems are withheld until the contest starts", async () => {
    const { slug } = await publishedContest(setter);
    const before = await getContestForViewer(db, contestant, slug, { now: T0 });
    expect(before).toMatchObject({ phase: "upcoming", problemsVisible: false, problems: [] });
    await expect(getContestProblemForViewer(db, contestant, slug, "A", { now: T0 })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const during = await getContestForViewer(db, contestant, slug, { now: at(2) });
    expect(during.problems.map((p) => p.label)).toEqual(["A"]);
    const after = await getContestForViewer(db, null, slug, { now: at(5) });
    expect(after.phase).toBe("ended");
  });

  it("the contestant statement never contains hidden tests, reference solutions or setter notes", async () => {
    const { slug } = await publishedContest(setter);
    const view = await getContestProblemForViewer(db, contestant, slug, "a", { now: at(2) });
    expect(view.problem.title).toBe("Sum of Two");
    expect(view.examples).toEqual([{ ordinal: 1, input: "1 2\n", output: "3\n", explanation: null }]);

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("SECRET-INPUT");
    expect(serialized).not.toContain("SECRET-REFERENCE");
    expect(serialized).not.toContain("fast-IO boilerplate");
    expect(Object.keys(view.problem)).not.toEqual(expect.arrayContaining(["templateNotes"]));
    expect(Object.keys(view.problem)).not.toContain("authorId");
  });

  it("registration is idempotent and closes when the contest ends", async () => {
    const { id, slug } = await publishedContest(setter);
    await registerForContest(db, contestant, id, ACK, { now: T0 });
    await registerForContest(db, contestant, id, ACK, { now: at(2) });
    expect(await getContestForViewer(db, contestant, slug, { now: at(2) })).toMatchObject({ isRegistered: true, canRegister: false });
    expect((await getContestForManagement(db, setter, id, { now: at(2) })).participants).toBe(1);

    await expect(registerForContest(db, reviewer, id, ACK, { now: at(3) })).rejects.toMatchObject({ code: "CONFLICT" });
    const { id: draft } = await createContest(db, setter, contestInput(at(1), at(2)));
    await expect(registerForContest(db, contestant, draft, ACK, { now: T0 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
