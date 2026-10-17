"use client";

import { useActionState } from "react";
import { echoed, initialActionState, type ActionState } from "@/lib/action-state";
import { Field, FormMessage, SubmitButton, TextArea } from "@/components/ui/form";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function NewTemplateForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Field label="Name" name="name" idPrefix="new-template" required maxLength={80} defaultValue={echoed(state, "name", "")} errors={state.fieldErrors} />
      <TextArea label="Code" name="source" idPrefix="new-template" rows={10} mono required defaultValue={echoed(state, "source", "")} errors={state.fieldErrors} />
      <div className="flex items-center gap-3">
        <SubmitButton>Save template</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function TemplateVersionForm({ action, templateId, source }: { action: Action; templateId: string; source: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <TextArea label="Code" name="source" idPrefix={`t-${templateId}`} rows={8} mono defaultValue={echoed(state, "source", source)} errors={state.fieldErrors} />
      <div className="flex items-center gap-3">
        <SubmitButton variant="secondary">Save as new version</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function SnippetForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Field label="Name" name="name" idPrefix="snippet" required maxLength={80} defaultValue={echoed(state, "name", "")} errors={state.fieldErrors} />
      <TextArea label="Code" name="source" idPrefix="snippet" rows={6} mono required defaultValue={echoed(state, "source", "")} errors={state.fieldErrors} />
      <div className="flex items-center gap-3">
        <SubmitButton variant="secondary">Approve snippet</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
