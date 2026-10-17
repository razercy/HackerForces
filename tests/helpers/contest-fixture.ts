import type { Db } from "@/lib/server/db";
import { attachProblem, createContest, getContestForManagement, publishContest, registerForContest } from "@/lib/server/services/contests";
import { addExample, addTest, createProblem, setReferenceSolution } from "@/lib/server/services/problems";
import type { Principal } from "@/lib/server/services/roles";
import { HOUR, contestInput, problemInput } from "./fixtures";

export const T0 = new Date("2030-01-01T10:00:00Z");
/** Hours after T0. The fixture contest runs from at(1) to at(3). */
export const at = (h: number) => new Date(T0.getTime() + h * HOUR);

export const HIDDEN_INPUT_MARKER = "HIDDEN-TEST-DATA";

/**
 * A published contest (running at(1)–at(3)) with problems A and B. Each has 3
 * hidden tests and 1 example. The given contestants are registered.
 */
export async function runningContest(db: Db, setter: Principal, contestants: Principal[]) {
  const { id } = await createContest(db, setter, contestInput(at(1), at(3)));
  const problemIds: string[] = [];
  for (const label of ["A", "B"]) {
    const { id: pid } = await createProblem(db, setter, problemInput());
    for (let i = 1; i <= 3; i++) await addTest(db, setter, pid, { input: `${HIDDEN_INPUT_MARKER} ${i}\n`, expectedOutput: `${i}\n` });
    await addExample(db, setter, pid, { input: "1 2\n", output: "3\n" });
    await setReferenceSolution(db, setter, pid, { language: "cpp17", source: "int main(){}" });
    await attachProblem(db, setter, id, { problemId: pid, label }, { now: T0 });
    problemIds.push(pid);
  }
  await publishContest(db, setter, id, { now: T0 });
  for (const c of contestants) await registerForContest(db, c, id, { now: T0 });
  const { slug } = await getContestForManagement(db, setter, id, { now: T0 });
  return { id, slug, problemIds };
}

export const AC_SOURCE = "#include <cstdio>\nint main() { return 0; }\n";
export const wa = (test = 1) => `// @mock-verdict wrong_answer test=${test}\nint main() {}\n`;
export const CE_SOURCE = "// no entry point\nint f() { return 1; }\n";
