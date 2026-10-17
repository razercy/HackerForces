"use client";

import { useActionState } from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { FormMessage, SubmitButton } from "@/components/ui/form";

export function RegisterButton({ action }: { action: (prev: ActionState) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex items-center gap-3">
      <SubmitButton pendingLabel="Registering…">Register</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
