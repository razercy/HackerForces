"use client";

import { useActionState } from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { TELEMETRY_NOTICE_VERSION } from "@/lib/telemetry/notice";
import { FormMessage, SubmitButton } from "@/components/ui/form";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Registration (or re-acknowledgement) form. The checkbox is required in the
 * browser and re-checked on the server, which also verifies the notice version.
 */
export function NoticeAcceptForm({ action, submitLabel }: { action: Action; submitLabel: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="noticeVersion" value={TELEMETRY_NOTICE_VERSION} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="accept" required className="mt-0.5 h-4 w-4" />
        <span>
          I have read the <a href="#activity-notice" className="underline">activity-recording notice</a> (version {TELEMETRY_NOTICE_VERSION}) and agree that my
          activity in the contest editor is recorded as described.
        </span>
      </label>
      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
