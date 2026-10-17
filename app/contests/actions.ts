"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { toActionState } from "@/lib/server/actions";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { registerForContest } from "@/lib/server/services/contests";

export async function registerAction(contestId: string, _prev: ActionState): Promise<ActionState> {
  try {
    const user = await requireUser();
    await registerForContest(getDb(), user, contestId);
  } catch (err) {
    return toActionState(err);
  }
  refresh();
  return { ok: true, message: "You're registered" };
}
