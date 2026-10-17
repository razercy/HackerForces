import "server-only";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/server/env";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Disabled when the secret is unset. */
export function isAuthorizedCron(req: Request): boolean {
  const secret = serverEnv().CRON_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const unauthorizedCron = () => Response.json({ error: { code: "UNAUTHENTICATED", message: "Unauthorized" } }, { status: 401 });
