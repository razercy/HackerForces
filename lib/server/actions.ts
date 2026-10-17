import "server-only";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/server/errors";

function formValues(fd: FormData | undefined): Record<string, string> | undefined {
  if (!fd) return undefined;
  const values: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) values[k] = v;
  return values;
}

/**
 * Map expected failures to form state (echoing the submitted values so the
 * form keeps them); unexpected errors are logged and hidden.
 */
export function toActionState(err: unknown, fd?: FormData): ActionState {
  // redirect()/notFound() throw control-flow errors that must propagate.
  if (err && typeof err === "object" && "digest" in err) throw err;
  const values = formValues(fd);
  if (err instanceof AppError) return { ok: false, message: err.message, values };
  if (err instanceof z.ZodError) {
    return { ok: false, message: "Please fix the highlighted fields", fieldErrors: z.flattenError(err).fieldErrors, values };
  }
  console.error(err);
  return { ok: false, message: "Something went wrong. Please try again.", values };
}

// ---- FormData helpers: forms send strings; schemas own the real validation.

export const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/** Empty string → null (optional fields). */
export const optional = (fd: FormData, key: string) => {
  const v = str(fd, key).trim();
  return v === "" ? null : v;
};

/** Comma/space separated list → array. */
export const list = (fd: FormData, key: string) =>
  str(fd, key)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
