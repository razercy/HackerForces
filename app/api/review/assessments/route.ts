import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/http";
import { listLatestAssessments } from "@/lib/server/integrity/review";

export const runtime = "nodejs";

const filters = z
  .object({
    contest: z.string().max(64).optional(),
    band: z.enum(["typical", "elevated", "insufficient_data"]).optional(),
    minScore: z.coerce.number().min(0).max(100).optional(),
    maxScore: z.coerce.number().min(0).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

/** Reviewer-only review queue (latest assessment per subject). */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const q = filters.parse(Object.fromEntries(req.nextUrl.searchParams));
    const items = await listLatestAssessments(getDb(), user, { contestSlug: q.contest, band: q.band, minScore: q.minScore, maxScore: q.maxScore, limit: q.limit });
    return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
