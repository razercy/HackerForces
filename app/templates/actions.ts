"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { str, toActionState } from "@/lib/server/actions";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { archiveTemplate, createTemplate, saveTemplateVersion } from "@/lib/server/services/templates";

export async function createTemplateAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    await createTemplate(getDb(), user, { name: str(fd, "name"), source: str(fd, "source") });
  } catch (err) {
    return toActionState(err, fd);
  }
  refresh();
  return { ok: true, message: "Template saved" };
}

export async function saveVersionAction(templateId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const { created } = await saveTemplateVersion(getDb(), user, templateId, { source: str(fd, "source") });
    refresh();
    return { ok: true, message: created ? "New version saved" : "No changes" };
  } catch (err) {
    return toActionState(err, fd);
  }
}

export async function archiveTemplateAction(templateId: string): Promise<void> {
  const user = await requireUser();
  await archiveTemplate(getDb(), user, templateId);
  refresh();
}
