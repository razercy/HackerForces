import { isAuthorizedCron, unauthorizedCron } from "@/lib/server/cron";
import { getDb } from "@/lib/server/db";
import { serverEnv } from "@/lib/server/env";
import { purgeExpiredTelemetry } from "@/lib/server/telemetry/retention";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Daily telemetry retention sweep. Disabled unless CRON_SECRET is configured. */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return unauthorizedCron();
  const { sessions, cutoff } = await purgeExpiredTelemetry(getDb(), { retentionDays: serverEnv().TELEMETRY_RETENTION_DAYS });
  return Response.json({ purgedSessions: sessions, cutoff });
}
