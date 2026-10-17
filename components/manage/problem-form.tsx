"use client";

import { useActionState } from "react";
import { echoed, initialActionState, type ActionState } from "@/lib/action-state";
import { Field, FormMessage, SubmitButton, TextArea } from "@/components/ui/form";

export type ProblemDefaults = {
  slug: string;
  title: string;
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  notes: string | null;
  timeLimitMs: number;
  memoryLimitMb: number;
  difficulty: number | null;
  tags: string[];
  templateNotes: string | null;
};

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function ProblemForm({ action, defaults, submitLabel }: { action: Action; defaults?: ProblemDefaults; submitLabel: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const e = state.fieldErrors;
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" name="title" required maxLength={120} defaultValue={echoed(state, "title", defaults?.title)} errors={e} />
        <Field label="Slug" name="slug" required maxLength={64} defaultValue={echoed(state, "slug", defaults?.slug)} errors={e} hint="e.g. sum-of-two" />
      </div>
      <TextArea label="Statement (Markdown)" name="statement" required rows={10} defaultValue={echoed(state, "statement", defaults?.statement)} errors={e} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextArea label="Input format" name="inputFormat" required rows={4} defaultValue={echoed(state, "inputFormat", defaults?.inputFormat)} errors={e} />
        <TextArea label="Output format" name="outputFormat" required rows={4} defaultValue={echoed(state, "outputFormat", defaults?.outputFormat)} errors={e} />
      </div>
      <TextArea label="Constraints" name="constraints" rows={3} defaultValue={echoed(state, "constraints", defaults?.constraints)} errors={e} />
      <TextArea label="Notes (optional, shown to contestants)" name="notes" rows={3} defaultValue={echoed(state, "notes", defaults?.notes)} errors={e} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Time limit (ms)" name="timeLimitMs" type="number" min={100} max={10000} step={100} required defaultValue={echoed(state, "timeLimitMs", defaults?.timeLimitMs ?? 1000)} errors={e} />
        <Field label="Memory limit (MB)" name="memoryLimitMb" type="number" min={16} max={1024} required defaultValue={echoed(state, "memoryLimitMb", defaults?.memoryLimitMb ?? 256)} errors={e} />
        <Field label="Expected difficulty" name="difficulty" type="number" min={800} max={3500} step={100} defaultValue={echoed(state, "difficulty", defaults?.difficulty)} errors={e} hint="800–3500, optional" />
      </div>
      <Field label="Tags" name="tags" defaultValue={echoed(state, "tags", defaults?.tags.join(", "))} errors={e} hint="Comma separated, e.g. greedy, math" />
      <TextArea
        label="Template notes (private to setters and admins)"
        name="templateNotes"
        rows={3}
        defaultValue={echoed(state, "templateNotes", defaults?.templateNotes)}
        errors={e}
        hint="Expected boilerplate, permitted snippets, unusually short solutions. Used later to avoid flagging legitimate code reuse."
      />
      <div className="flex items-center gap-3">
        <SubmitButton>{submitLabel}</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
