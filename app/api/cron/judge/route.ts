import { isAuthorizedCron, unauthorizedCron } from "@/lib/server/cron";
import { getDb } from "@/lib/server/db";
import { getJudge } from "@/lib/server/judge";
import { drainJobs } from "@/lib/server/judge/worker";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Safety-net drain of the judge queue. Disabled unless CRON_SECRET is configured. */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return unauthorizedCron();
  const { processed } = await drainJobs(getDb(), getJudge(), { maxJobs: 20, budgetMs: 60_000 });
  return Response.json({ processed });
}
