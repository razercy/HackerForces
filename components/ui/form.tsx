"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps, ReactNode } from "react";

export type FieldErrors = Record<string, string[] | undefined> | undefined;

export const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 aria-[invalid=true]:border-red-500 dark:border-zinc-700 dark:bg-zinc-900";

function FieldShell({ label, id, name, errors, hint, children }: { label: string; id: string; name: string; errors: FieldErrors; hint?: string; children: ReactNode }) {
  const err = errors?.[name]?.[0];
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {children}
      {hint && !err && <p className="text-xs text-zinc-500">{hint}</p>}
      {err && (
        <p id={`${id}-error`} className="text-xs text-red-600 dark:text-red-400">
          {err}
        </p>
      )}
    </div>
  );
}

// `idPrefix` keeps ids unique when two forms on a page share a field name.
type Common = { label: string; name: string; errors?: FieldErrors; hint?: string; idPrefix?: string };

type InputProps = ComponentProps<"input"> & Common;
export function Field({ label, name, errors, hint, idPrefix, ...props }: InputProps) {
  const id = idPrefix ? `${idPrefix}-${name}` : name;
  const invalid = !!errors?.[name]?.length;
  return (
    <FieldShell label={label} id={id} name={name} errors={errors} hint={hint}>
      <input id={id} name={name} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} className={inputClass} {...props} />
    </FieldShell>
  );
}

type TextAreaProps = ComponentProps<"textarea"> & Common & { mono?: boolean };
export function TextArea({ label, name, errors, hint, mono, idPrefix, ...props }: TextAreaProps) {
  const id = idPrefix ? `${idPrefix}-${name}` : name;
  const invalid = !!errors?.[name]?.length;
  return (
    <FieldShell label={label} id={id} name={name} errors={errors} hint={hint}>
      <textarea
        id={id}
        name={name}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className={`${inputClass} ${mono ? "font-mono text-xs" : ""}`}
        {...props}
      />
    </FieldShell>
  );
}

const variants = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  secondary: "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800",
  danger: "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950",
};

export function SubmitButton({ children, variant = "primary", pendingLabel = "Saving…" }: { children: ReactNode; variant?: keyof typeof variants; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${variants[variant]}`}>
      {pending ? pendingLabel : children}
    </button>
  );
}

export function FormMessage({ state }: { state: { ok?: boolean; message?: string } }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
      {state.message}
    </p>
  );
}
