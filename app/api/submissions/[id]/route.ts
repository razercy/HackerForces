import type { NextRequest } from "next/server";
import { isTerminal } from "@/lib/submissions";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/http";
import { scheduleDrain } from "@/lib/server/judge/schedule";
import { hasClaimableJob } from "@/lib/server/judge/worker";
import { getSubmissionForViewer } from "@/lib/server/services/submissions";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Status poll. Also recovers stalled jobs: if the job is claimable, a drain is scheduled. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/submissions/[id]">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const s = await getSubmissionForViewer(getDb(), user, id);
    if (!isTerminal(s.status) && (await hasClaimableJob(getDb(), id, new Date()))) scheduleDrain();
    return Response.json(
      {
        id: s.id,
        kind: s.kind,
        status: s.status,
        verdict: s.verdict,
        timeMs: s.timeMs,
        memoryKb: s.memoryKb,
        passedTests: s.passedTests,
        totalTests: s.totalTests,
        failedTest: s.failedTest,
        compileOutput: s.compileOutput,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
