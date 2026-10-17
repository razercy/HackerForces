"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { str, toActionState } from "@/lib/server/actions";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { submitResponse } from "@/lib/server/review/cases";

export async function submitResponseAction(caseId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    await submitResponse(getDb(), user, caseId, str(fd, "body"));
  } catch (err) {
    return toActionState(err, fd);
  }
  refresh();
  return { ok: true, message: "Your response was recorded and will be read by the review team." };
}
