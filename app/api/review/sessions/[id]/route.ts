import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/http";
import { getSessionTimeline } from "@/lib/server/telemetry/timeline";

export const runtime = "nodejs";

/** Reviewer-only session timeline (JSON). The reviewer UI arrives in Phase 5. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/review/sessions/[id]">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    return Response.json(await getSessionTimeline(getDb(), user, id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
