"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { str, toActionState } from "@/lib/server/actions";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import {
  attachProblem,
  createContest,
  detachProblem,
  publishContest,
  unpublishContest,
  updateContest,
} from "@/lib/server/services/contests";

function contestFromForm(fd: FormData) {
  return {
    slug: str(fd, "slug"),
    title: str(fd, "title"),
    description: str(fd, "description"),
    startsAt: str(fd, "startsAt"),
    endsAt: str(fd, "endsAt"),
  };
}

export async function createContestAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const actor = await requireUser();
    ({ id } = await createContest(getDb(), actor, contestFromForm(fd)));
  } catch (err) {
    return toActionState(err, fd);
  }
  redirect(`/manage/contests/${id}`);
}

export async function updateContestAction(contestId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await updateContest(getDb(), actor, contestId, contestFromForm(fd));
  } catch (err) {
    return toActionState(err, fd);
  }
  refresh();
  return { ok: true, message: "Saved" };
}

export async function attachProblemAction(contestId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await attachProblem(getDb(), actor, contestId, { problemId: str(fd, "problemId"), label: str(fd, "label") });
  } catch (err) {
    return toActionState(err, fd);
  }
  refresh();
  return { ok: true, message: "Problem added" };
}

export async function detachProblemAction(contestId: string, problemId: string): Promise<void> {
  const actor = await requireUser();
  await detachProblem(getDb(), actor, contestId, problemId);
  refresh();
}

export async function publishContestAction(contestId: string, _prev: ActionState): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await publishContest(getDb(), actor, contestId);
  } catch (err) {
    return toActionState(err);
  }
  refresh();
  return { ok: true, message: "Published" };
}

export async function unpublishContestAction(contestId: string, _prev: ActionState): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await unpublishContest(getDb(), actor, contestId);
  } catch (err) {
    return toActionState(err);
  }
  refresh();
  return { ok: true, message: "Moved back to draft" };
}
