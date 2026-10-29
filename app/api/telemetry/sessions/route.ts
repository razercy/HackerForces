import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/http";
import { assertSameOrigin } from "@/lib/server/origin";
import { startSession } from "@/lib/server/telemetry/ingest";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const body: unknown = await req.json().catch(() => null);
    const { sessionId } = await startSession(getDb(), user, body, { userAgent: req.headers.get("user-agent") });
    return Response.json({ sessionId }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
