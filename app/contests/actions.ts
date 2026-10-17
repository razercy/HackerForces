"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { str, toActionState } from "@/lib/server/actions";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { acknowledgeNotice, registerForContest } from "@/lib/server/services/contests";

const mustAccept: ActionState = { ok: false, message: "Tick the box to accept the activity-recording notice" };

export async function registerAction(contestId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  if (fd.get("accept") !== "on") return mustAccept;
  try {
    const user = await requireUser();
    await registerForContest(getDb(), user, contestId, { noticeVersion: str(fd, "noticeVersion") });
  } catch (err) {
    return toActionState(err);
  }
  refresh();
  return { ok: true, message: "You're registered" };
}

export async function acknowledgeNoticeAction(contestId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  if (fd.get("accept") !== "on") return mustAccept;
  try {
    const user = await requireUser();
    await acknowledgeNotice(getDb(), user, contestId, { noticeVersion: str(fd, "noticeVersion") });
  } catch (err) {
    return toActionState(err);
  }
  refresh();
  return { ok: true, message: "Thanks — you can now use the editor" };
}
