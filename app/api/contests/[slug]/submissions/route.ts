import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { invalidInput } from "@/lib/server/errors";
import { errorResponse } from "@/lib/server/http";
import { assertSameOrigin } from "@/lib/server/origin";
import { scheduleDrain } from "@/lib/server/judge/schedule";
import { createSubmission } from "@/lib/server/services/submissions";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 64 KB source limit plus JSON overhead. Checked before parsing. */
const MAX_BODY_BYTES = 80 * 1024;

export async function POST(req: NextRequest, ctx: RouteContext<"/api/contests/[slug]/submissions">) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const { slug } = await ctx.params;
    const body = await req.text();
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) throw invalidInput("Request too large");
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw invalidInput("Body must be JSON");
    }
    const { id } = await createSubmission(getDb(), user, slug, json);
    scheduleDrain();
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
