import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { invalidInput } from "@/lib/server/errors";
import { errorResponse } from "@/lib/server/http";
import { ingestBatch } from "@/lib/server/telemetry/ingest";
import { MAX_BATCH_BYTES } from "@/lib/telemetry/events";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BATCH_BYTES) throw invalidInput("Batch too large");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw invalidInput("Body must be JSON");
    }
    return Response.json(await ingestBatch(getDb(), user, body));
  } catch (err) {
    return errorResponse(err);
  }
}
