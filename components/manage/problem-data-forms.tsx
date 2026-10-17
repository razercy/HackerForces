"use client";

import { useActionState } from "react";
import { LANGUAGE_LABELS, LANGUAGES } from "@/lib/languages";
import { echoed, initialActionState, type ActionState } from "@/lib/action-state";
import { FormMessage, SubmitButton, TextArea, inputClass } from "@/components/ui/form";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

// React resets uncontrolled forms after each action: on success the add forms
// clear for the next entry; on failure the echoed values repopulate them.

export function AddExampleForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextArea label="Sample input" idPrefix="example" name="input" defaultValue={echoed(state, "input", "")} rows={4} mono errors={state.fieldErrors} />
        <TextArea label="Sample output" idPrefix="example" name="output" defaultValue={echoed(state, "output", "")} rows={4} mono errors={state.fieldErrors} />
      </div>
      <TextArea label="Explanation (optional)" idPrefix="example" name="explanation" defaultValue={echoed(state, "explanation", "")} rows={2} errors={state.fieldErrors} />
      <div className="flex items-center gap-3">
        <SubmitButton variant="secondary">Add example</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function AddTestForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextArea label="Input" idPrefix="test" name="input" defaultValue={echoed(state, "input", "")} rows={6} mono errors={state.fieldErrors} hint="Max 256 KB" />
        <TextArea label="Expected output" idPrefix="test" name="expectedOutput" defaultValue={echoed(state, "expectedOutput", "")} rows={6} mono errors={state.fieldErrors} hint="Max 256 KB" />
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton variant="secondary">Add hidden test</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function ReferenceSolutionForm({ action, defaultSource }: { action: Action; defaultSource?: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor="reference-language" className="font-medium">
          Language
        </label>
        <select id="reference-language" name="language" className={`${inputClass} sm:w-60`} defaultValue="cpp17">
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {LANGUAGE_LABELS[l]}
            </option>
          ))}
        </select>
      </div>
      <TextArea label="Source" idPrefix="reference" name="source" rows={14} mono defaultValue={echoed(state, "source", defaultSource)} errors={state.fieldErrors} />
      <div className="flex items-center gap-3">
        <SubmitButton variant="secondary">Save reference solution</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
