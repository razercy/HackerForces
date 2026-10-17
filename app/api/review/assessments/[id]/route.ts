import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/http";
import { getAssessment } from "@/lib/server/integrity/review";

export const runtime = "nodejs";

/** Reviewer-only assessment detail. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/review/assessments/[id]">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    return Response.json(await getAssessment(getDb(), user, id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
