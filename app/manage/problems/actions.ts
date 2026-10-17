"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { list, optional, str, toActionState } from "@/lib/server/actions";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import {
  addExample,
  addTest,
  createProblem,
  deleteExample,
  deleteTest,
  setReferenceSolution,
  updateProblem,
} from "@/lib/server/services/problems";

// Thin entry points: parse FormData into plain objects, then delegate to the
// service, which owns validation and authorization.

function problemFromForm(fd: FormData) {
  return {
    slug: str(fd, "slug"),
    title: str(fd, "title"),
    statement: str(fd, "statement"),
    inputFormat: str(fd, "inputFormat"),
    outputFormat: str(fd, "outputFormat"),
    constraints: str(fd, "constraints"),
    notes: optional(fd, "notes"),
    timeLimitMs: str(fd, "timeLimitMs"),
    memoryLimitMb: str(fd, "memoryLimitMb"),
    difficulty: optional(fd, "difficulty"),
    tags: list(fd, "tags"),
    templateNotes: optional(fd, "templateNotes"),
  };
}

export async function createProblemAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const actor = await requireUser();
    ({ id } = await createProblem(getDb(), actor, problemFromForm(fd)));
  } catch (err) {
    return toActionState(err, fd);
  }
  redirect(`/manage/problems/${id}`);
}

export async function updateProblemAction(problemId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await updateProblem(getDb(), actor, problemId, problemFromForm(fd));
  } catch (err) {
    return toActionState(err, fd);
  }
  refresh();
  return { ok: true, message: "Saved" };
}

export async function addExampleAction(problemId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await addExample(getDb(), actor, problemId, { input: str(fd, "input"), output: str(fd, "output"), explanation: optional(fd, "explanation") });
  } catch (err) {
    return toActionState(err, fd);
  }
  refresh();
  return { ok: true, message: "Example added" };
}

export async function deleteExampleAction(problemId: string, exampleId: string): Promise<void> {
  const actor = await requireUser();
  await deleteExample(getDb(), actor, problemId, exampleId);
  refresh();
}

export async function addTestAction(problemId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await requireUser();
    const { ordinal } = await addTest(getDb(), actor, problemId, { input: str(fd, "input"), expectedOutput: str(fd, "expectedOutput") });
    refresh();
    return { ok: true, message: `Test #${ordinal} added` };
  } catch (err) {
    return toActionState(err, fd);
  }
}

export async function deleteTestAction(problemId: string, testId: string): Promise<void> {
  const actor = await requireUser();
  await deleteTest(getDb(), actor, problemId, testId);
  refresh();
}

export async function setReferenceSolutionAction(problemId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await setReferenceSolution(getDb(), actor, problemId, { language: str(fd, "language"), source: str(fd, "source") });
  } catch (err) {
    return toActionState(err, fd);
  }
  refresh();
  return { ok: true, message: "Reference solution saved" };
}
