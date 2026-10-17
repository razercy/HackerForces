"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { optional, str, toActionState } from "@/lib/server/actions";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { addNote, confirmDecision, openCaseManually, recordDecision, reopenCase } from "@/lib/server/review/cases";

export async function recordDecisionAction(caseId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const { status } = await recordDecision(getDb(), user, caseId, { outcome: str(fd, "outcome"), rationale: str(fd, "rationale"), assessmentId: optional(fd, "assessmentId") });
    refresh();
    return { ok: true, message: status === "awaiting_confirmation" ? "Recorded. Awaiting confirmation by a different admin." : "Decision recorded; case closed." };
  } catch (err) {
    return toActionState(err, fd);
  }
}

export async function confirmDecisionAction(caseId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const { status } = await confirmDecision(getDb(), user, caseId, { verdict: str(fd, "verdict"), rationale: str(fd, "rationale") });
    refresh();
    return { ok: true, message: status === "closed" ? "Confirmed. The decision is now in effect." : "Rejected. The case is back in review." };
  } catch (err) {
    return toActionState(err, fd);
  }
}

export async function addNoteAction(caseId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    await addNote(getDb(), user, caseId, str(fd, "body"));
  } catch (err) {
    return toActionState(err, fd);
  }
  refresh();
  return { ok: true, message: "Note added" };
}

export async function reopenCaseAction(caseId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    await reopenCase(getDb(), user, caseId, str(fd, "reason"));
  } catch (err) {
    return toActionState(err, fd);
  }
  refresh();
  return { ok: true, message: "Case reopened" };
}

export async function openCaseAction(assessmentId: string): Promise<void> {
  const user = await requireUser();
  const { id } = await openCaseManually(getDb(), user, assessmentId);
  redirect(`/review/cases/${id}`);
}
