"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { requeueDeadAnalysisJob, requeueDeadJudgeJob } from "@/lib/server/services/ops";
import { scheduleDrain } from "@/lib/server/judge/schedule";

export async function requeueJudgeJobAction(jobId: string): Promise<void> {
  const user = await requireUser();
  await requeueDeadJudgeJob(getDb(), user, jobId);
  scheduleDrain();
  refresh();
}

export async function requeueAnalysisJobAction(jobId: string): Promise<void> {
  const user = await requireUser();
  await requeueDeadAnalysisJob(getDb(), user, jobId);
  refresh();
}
