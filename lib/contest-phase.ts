/** Pure, client-safe contest lifecycle derived from status and the clock. */
export type ContestPhase = "draft" | "upcoming" | "running" | "ended";

export function contestPhase(c: { status: "draft" | "published"; startsAt: Date; endsAt: Date }, now: Date): ContestPhase {
  if (c.status === "draft") return "draft";
  if (now < c.startsAt) return "upcoming";
  if (now < c.endsAt) return "running";
  return "ended";
}

/** Why the Solve section is closed for this viewer, checked in this order. Null when they may submit. */
export type SolveBlock = "sign_in" | "ended" | "register" | "acknowledge" | "not_started";

export function solveBlock(
  signedIn: boolean,
  c: { phase: ContestPhase; isRegistered: boolean; needsAcknowledgement: boolean },
): SolveBlock | null {
  if (!signedIn) return "sign_in";
  if (c.phase === "ended") return "ended";
  if (!c.isRegistered) return "register";
  if (c.needsAcknowledgement) return "acknowledge";
  // Draft contests are visible only to their managers and are not open for submissions either.
  if (c.phase !== "running") return "not_started";
  return null;
}
