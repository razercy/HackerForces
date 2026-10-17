import type { ElevatedRole } from "@/lib/auth/roles";
import type { Db } from "@/lib/server/db";
import { SYSTEM, getRoles, grantRole, type Principal } from "@/lib/server/services/roles";
import { insertUser } from "./db";

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

/** A real user row with the given elevated roles, returned as a Principal. */
export async function principal(db: Db, ...roles: ElevatedRole[]): Promise<Principal> {
  const u = await insertUser(db);
  for (const r of roles) await grantRole(db, SYSTEM, u.id, r);
  return { userId: u.id, roles: await getRoles(db, u.id) };
}

export function problemInput(overrides: Record<string, unknown> = {}) {
  return {
    slug: `sum-${uniq()}`,
    title: "Sum of Two",
    statement: "Given $a$ and $b$, print $a+b$.",
    inputFormat: "Two integers.",
    outputFormat: "One integer.",
    constraints: "|a|, |b| ≤ 10^9",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    difficulty: 800,
    tags: ["math"],
    templateNotes: "Most solutions are 5 lines; fast-IO boilerplate is expected.",
    ...overrides,
  };
}

export function contestInput(start: Date, end: Date, overrides: Record<string, unknown> = {}) {
  return {
    slug: `round-${uniq()}`,
    title: "Practice Round",
    description: "Warm-up.",
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    ...overrides,
  };
}

export const HOUR = 60 * 60 * 1000;
