// Operator tool: (re-)run integrity analysis for every subject of a contest.
//   npm run analyze -- <contest-slug>
// Useful after a ruleset/feature change or for backfills. Requires DATABASE_URL.
import { existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/server/db";
import { contest, submission } from "@/lib/server/db/schema";
import { drainAnalysisJobs, enqueueAnalysis } from "@/lib/server/integrity/pipeline";

if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npm run analyze -- <contest-slug>");
    process.exit(2);
  }
  const db = getDb();
  const [c] = await db.select({ id: contest.id }).from(contest).where(eq(contest.slug, slug));
  if (!c) {
    console.error(`No contest ${slug}`);
    process.exit(1);
  }
  const subjects = await db
    .selectDistinct({ userId: submission.userId, contestId: submission.contestId, problemId: submission.problemId })
    .from(submission)
    .where(and(eq(submission.contestId, c.id), eq(submission.kind, "submission")));
  const now = new Date();
  for (const s of subjects) await enqueueAnalysis(db, s, now);
  let total = 0;
  for (;;) {
    const { processed } = await drainAnalysisJobs(db, { maxJobs: 50, budgetMs: 60_000 });
    total += processed;
    if (processed === 0) break;
  }
  console.log(`${subjects.length} subject(s) enqueued, ${total} job(s) processed`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
