// Development seed: demo accounts and a small published contest.
//   npm run seed
// Idempotent. Refuses to run when NODE_ENV=production. Demo accounts share
// SEED_DEMO_PASSWORD from .env.local (git-ignored); never reuse it anywhere real.
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { ElevatedRole } from "@/lib/auth/roles";
import { createAuth } from "@/lib/server/auth/create-auth";
import { getDb } from "@/lib/server/db";
import { contest, problem, user } from "@/lib/server/db/schema";
import { serverEnv } from "@/lib/server/env";
import { attachProblem, createContest, publishContest } from "@/lib/server/services/contests";
import { addExample, addTest, createProblem, setReferenceSolution } from "@/lib/server/services/problems";
import { SYSTEM, getRoles, grantRole, type Principal } from "@/lib/server/services/roles";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const DEMO_USERS: { email: string; name: string; roles: ElevatedRole[] }[] = [
  { email: "setter@demo.test", name: "Demo Setter", roles: ["problem_setter"] },
  { email: "reviewer@demo.test", name: "Demo Reviewer", roles: ["reviewer"] },
  // A second person for the two-person rule: confirms reviewers' violation decisions.
  { email: "admin@demo.test", name: "Demo Admin", roles: ["admin"] },
  { email: "contestant@demo.test", name: "Demo Contestant", roles: [] },
];

const SUM_SOURCE = `#include <bits/stdc++.h>
int main() {
    long long a, b;
    std::cin >> a >> b;
    std::cout << a + b << "\\n";
}
`;

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 10) throw new Error("Set SEED_DEMO_PASSWORD (10+ chars) in .env.local");

  const env = serverEnv();
  const db = getDb();
  const auth = createAuth({ db, secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL });

  const principals: Record<string, Principal> = {};
  for (const u of DEMO_USERS) {
    let [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, u.email));
    if (!row) {
      const res = await auth.api.signUpEmail({ body: { email: u.email, password, name: u.name } });
      row = { id: res.user.id };
      console.log(`created ${u.email}`);
    }
    for (const r of u.roles) await grantRole(db, SYSTEM, row.id, r);
    principals[u.email] = { userId: row.id, roles: await getRoles(db, row.id) };
  }
  const setter = principals["setter@demo.test"]!;

  let [p] = await db.select({ id: problem.id }).from(problem).where(eq(problem.slug, "demo-sum-of-two"));
  if (!p) {
    p = await createProblem(db, setter, {
      slug: "demo-sum-of-two",
      title: "Sum of Two",
      statement: "You are given two integers `a` and `b`. Print their sum.",
      inputFormat: "A single line with two integers `a` and `b`.",
      outputFormat: "Print `a + b`.",
      constraints: "- `-10^9 ≤ a, b ≤ 10^9`",
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      difficulty: 800,
      tags: ["implementation", "math"],
      templateNotes: "Trivial; a fast-IO template plus 3 lines is the expected shape.",
    });
    await addExample(db, setter, p.id, { input: "1 2\n", output: "3\n" });
    for (const [a, b] of [[1, 2], [-5, 5], [1_000_000_000, 1_000_000_000], [-1_000_000_000, -1]] as const) {
      await addTest(db, setter, p.id, { input: `${a} ${b}\n`, expectedOutput: `${a + b}\n` });
    }
    await setReferenceSolution(db, setter, p.id, { language: "cpp17", source: SUM_SOURCE });
    console.log("created problem demo-sum-of-two");
  }

  const [c] = await db.select({ id: contest.id }).from(contest).where(eq(contest.slug, "demo-round"));
  if (!c) {
    const now = Date.now();
    const { id } = await createContest(db, setter, {
      slug: "demo-round",
      title: "Demo Round",
      description: "A seeded practice contest for local development.",
      startsAt: new Date(now + 60_000).toISOString(),
      endsAt: new Date(now + 7 * 24 * 3600_000).toISOString(),
    });
    await attachProblem(db, setter, id, { problemId: p.id, label: "A" });
    await publishContest(db, setter, id);
    console.log("created and published demo-round (starts in 1 minute)");
  }

  console.log(`demo accounts: ${DEMO_USERS.map((u) => u.email).join(", ")} (password: SEED_DEMO_PASSWORD)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
