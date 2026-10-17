// Operator bootstrap: grant an elevated role to an existing account.
//   npm run grant-role -- <email> <admin|problem_setter|reviewer>
// Runs as SYSTEM (audited with a null actor). Requires DATABASE_URL.
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { isElevatedRole } from "@/lib/auth/roles";
import { getDb } from "@/lib/server/db";
import { user } from "@/lib/server/db/schema";
import { SYSTEM, getRoles, grantRole } from "@/lib/server/services/roles";

if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  const [email, role] = process.argv.slice(2);
  if (!email || !role || !isElevatedRole(role)) {
    console.error("Usage: npm run grant-role -- <email> <admin|problem_setter|reviewer>");
    process.exit(2);
  }
  const db = getDb();
  const [target] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
  if (!target) {
    console.error(`No account with email ${email}. Sign up first.`);
    process.exit(1);
  }
  await grantRole(db, SYSTEM, target.id, role);
  console.log(`${email}: ${(await getRoles(db, target.id)).join(", ")}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
