import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/server/db";
import { serverEnv } from "@/lib/server/env";
import { getJudge } from "@/lib/server/judge";
import { drainJobs } from "@/lib/server/judge/worker";

export const runtime = "nodejs";
export const maxDuration = 120;

function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Safety-net drain of the judge queue (Vercel Cron sends `Authorization:
 * Bearer $CRON_SECRET`). Disabled unless CRON_SECRET is configured.
 */
export async function GET(req: Request) {
  if (!authorized(req.headers.get("authorization"), serverEnv().CRON_SECRET)) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Unauthorized" } }, { status: 401 });
  }
  const { processed } = await drainJobs(getDb(), getJudge(), { maxJobs: 20, budgetMs: 60_000 });
  return Response.json({ processed });
}
