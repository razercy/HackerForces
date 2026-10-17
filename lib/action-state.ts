/** Serializable result of a form Server Action, consumed by `useActionState`. Client-safe. */
export type ActionState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /**
   * Submitted values, echoed back on failure. React 19 resets uncontrolled
   * forms after every action, so forms use these as defaults to keep input.
   */
  values?: Record<string, string>;
};

/** The echoed value for a field if the last submit failed, otherwise the fallback. */
export function echoed(state: ActionState, name: string, fallback: string | number | null | undefined): string {
  return state.values?.[name] ?? (fallback == null ? "" : String(fallback));
}

export const initialActionState: ActionState = {};
