"use client";

import { useActionState } from "react";
import { echoed, initialActionState, type ActionState } from "@/lib/action-state";
import { DateTimeField } from "@/components/time";
import { Field, FormMessage, SubmitButton, TextArea, inputClass } from "@/components/ui/form";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export type ContestDefaults = { slug: string; title: string; description: string; startsAt: string; endsAt: string };

export function ContestForm({ action, defaults, submitLabel }: { action: Action; defaults?: ContestDefaults; submitLabel: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const e = state.fieldErrors;
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" name="title" required maxLength={120} defaultValue={echoed(state, "title", defaults?.title)} errors={e} />
        <Field label="Slug" name="slug" required maxLength={64} defaultValue={echoed(state, "slug", defaults?.slug)} errors={e} hint="e.g. round-1" />
      </div>
      <TextArea label="Description (Markdown)" name="description" rows={4} defaultValue={echoed(state, "description", defaults?.description)} errors={e} />
      <div className="grid gap-4 sm:grid-cols-2">
        <DateTimeField name="startsAt" label="Starts" defaultIso={state.values?.startsAt || defaults?.startsAt} error={e?.startsAt?.[0]} />
        <DateTimeField name="endsAt" label="Ends" defaultIso={state.values?.endsAt || defaults?.endsAt} error={e?.endsAt?.[0]} />
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton>{submitLabel}</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function AttachProblemForm({ action, options, suggestedLabel }: { action: Action; options: { id: string; title: string; slug: string }[]; suggestedLabel: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  if (options.length === 0) return <p className="text-sm text-zinc-600 dark:text-zinc-400">No more problems available to add. Create one first.</p>;
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor="problemId" className="font-medium">
          Problem
        </label>
        <select id="problemId" name="problemId" className={`${inputClass} sm:w-72`}>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} ({p.slug})
            </option>
          ))}
        </select>
      </div>
      <div className="w-24">
        <Field label="Label" name="label" required maxLength={2} defaultValue={echoed(state, "label", suggestedLabel)} errors={state.fieldErrors} />
      </div>
      <SubmitButton variant="secondary">Add</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function StatusActionButton({ action, label, variant }: { action: (prev: ActionState) => Promise<ActionState>; label: string; variant: "primary" | "secondary" }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex items-center gap-3">
      <SubmitButton variant={variant} pendingLabel="Working…">
        {label}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
