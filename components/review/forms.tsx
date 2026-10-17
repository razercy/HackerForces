"use client";

import { useActionState } from "react";
import { echoed, initialActionState, type ActionState } from "@/lib/action-state";
import { MIN_RATIONALE, OUTCOME_LABELS, REVIEW_OUTCOMES } from "@/lib/review";
import { FormMessage, SubmitButton, TextArea } from "@/components/ui/form";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function DecisionForm({ action, assessmentId }: { action: Action; assessmentId: string | null }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="assessmentId" value={assessmentId ?? ""} />
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1 font-medium">Outcome</legend>
        {REVIEW_OUTCOMES.map((o) => (
          <label key={o} className="flex items-center gap-2">
            <input type="radio" name="outcome" value={o} required defaultChecked={echoed(state, "outcome", "") === o} />
            {OUTCOME_LABELS[o]}
          </label>
        ))}
      </fieldset>
      <TextArea
        label="Rationale"
        name="rationale"
        idPrefix="decision"
        rows={4}
        required
        minLength={MIN_RATIONALE}
        defaultValue={echoed(state, "rationale", "")}
        errors={state.fieldErrors}
        hint={`At least ${MIN_RATIONALE} characters. Cite the evidence you relied on. If the outcome is a confirmed violation, the contestant will see this text.`}
      />
      <div className="flex items-center gap-3">
        <SubmitButton>Record decision</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function ConfirmForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1 font-medium">Second-person review</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="verdict" value="confirmed" required /> Confirm: the decision takes effect (problem excluded in standings, contestant notified)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="verdict" value="rejected" required /> Reject: return the case to review
        </label>
      </fieldset>
      <TextArea label="Reason" name="rationale" idPrefix="confirm" rows={3} required minLength={10} defaultValue={echoed(state, "rationale", "")} errors={state.fieldErrors} />
      <div className="flex items-center gap-3">
        <SubmitButton>Submit</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function TextForm({ action, name, label, submitLabel, rows = 3 }: { action: Action; name: string; label: string; submitLabel: string; rows?: number }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <TextArea label={label} name={name} idPrefix={`tf-${name}`} rows={rows} required maxLength={5000} defaultValue={echoed(state, name, "")} errors={state.fieldErrors} />
      <div className="flex items-center gap-3">
        <SubmitButton variant="secondary">{submitLabel}</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
