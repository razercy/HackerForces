/** Pure, client-safe contest lifecycle derived from status and the clock. */
export type ContestPhase = "draft" | "upcoming" | "running" | "ended";

export function contestPhase(c: { status: "draft" | "published"; startsAt: Date; endsAt: Date }, now: Date): ContestPhase {
  if (c.status === "draft") return "draft";
  if (now < c.startsAt) return "upcoming";
  if (now < c.endsAt) return "running";
  return "ended";
}
