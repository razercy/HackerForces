import { BAND_LABELS, CASE_STATUS_LABELS, OUTCOME_LABELS, type CaseStatus, type ReviewOutcome } from "@/lib/review";

const pill = "inline-block rounded-full px-2 py-0.5 text-xs font-medium";

export function BandBadge({ band, score }: { band: keyof typeof BAND_LABELS | null; score?: number | null }) {
  if (!band) return <span className={`${pill} bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400`}>Not assessed</span>;
  const cls =
    band === "elevated"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
      : band === "typical"
        ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        : "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300";
  return (
    <span className={`${pill} ${cls}`}>
      {BAND_LABELS[band]}
      {score != null ? ` · ${score}` : ""}
    </span>
  );
}

export function StatusBadge({ status }: { status: CaseStatus }) {
  const cls = status === "closed" ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" : status === "open" ? "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300" : "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-300";
  return <span className={`${pill} ${cls}`}>{CASE_STATUS_LABELS[status]}</span>;
}

export function OutcomeText({ outcome }: { outcome: ReviewOutcome }) {
  return <span className="font-medium">{OUTCOME_LABELS[outcome].replace(" (requires admin confirmation)", "")}</span>;
}
