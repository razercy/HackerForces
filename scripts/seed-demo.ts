// Development seed for demos: a finished contest with SYNTHETIC integrity data.
//   npm run seed && npm run seed:demo
// Twelve synthetic contestants (synthetic-NN@demo.test, password SEED_DEMO_PASSWORD) play
// labelled scenarios through the real telemetry, judging (mock judge) and scoring code;
// four review cases are left in different states. Idempotent. Refuses NODE_ENV=production;
// never point it at a production database.
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { CAST, castEmail, castName, seedIntegrityDemo } from "@/eval/demo";
import { createAuth } from "@/lib/server/auth/create-auth";
import { getDb } from "@/lib/server/db";
import { user } from "@/lib/server/db/schema";
import { serverEnv } from "@/lib/server/env";
import { getRoles, type Principal } from "@/lib/server/services/roles";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 10) throw new Error("Set SEED_DEMO_PASSWORD (10+ chars) in .env.local");

  const env = serverEnv();
  const db = getDb();
  const auth = createAuth({ db, secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL });

  const existing = async (email: string): Promise<Principal | null> => {
    const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
    return row ? { userId: row.id, roles: await getRoles(db, row.id) } : null;
  };
  const staff = async (email: string) => {
    const p = await existing(email);
    if (!p) throw new Error(`${email} not found. Run \`npm run seed\` first.`);
    return p;
  };
  const [setter, reviewer, admin] = [await staff("setter@demo.test"), await staff("reviewer@demo.test"), await staff("admin@demo.test")];

  const contestants: Principal[] = [];
  for (let i = 0; i < CAST.length; i++) {
    let p = await existing(castEmail(i));
    if (!p) {
      const res = await auth.api.signUpEmail({ body: { email: castEmail(i), password, name: castName(i) } });
      p = { userId: res.user.id, roles: await getRoles(db, res.user.id) };
    }
    contestants.push(p);
  }
  console.log(`synthetic contestants ready (${CAST.length})`);

  const started = Date.now();
  const result = await seedIntegrityDemo(db, { setter, reviewer, admin, contestants }, { log: (m) => console.log(`  ${m} (${Math.round((Date.now() - started) / 1000)} s)`) });
  console.log(result.created ? `created /contests/${result.slug}` : `/contests/${result.slug} already exists; left unchanged`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
