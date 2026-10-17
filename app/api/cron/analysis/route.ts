import { isAuthorizedCron, unauthorizedCron } from "@/lib/server/cron";
import { getDb } from "@/lib/server/db";
import { drainAnalysisJobs, enqueueEndedContests } from "@/lib/server/integrity/pipeline";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Re-scores recently ended contests against their complete cohort, then drains the queue. */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return unauthorizedCron();
  const { enqueued } = await enqueueEndedContests(getDb());
  const { processed } = await drainAnalysisJobs(getDb(), { maxJobs: 100, budgetMs: 90_000 });
  return Response.json({ enqueued, processed });
}
