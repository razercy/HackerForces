import { VERDICT_LABELS, type SubmissionStatus, type Verdict } from "@/lib/submissions";

const tone = {
  good: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  bad: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

export function VerdictBadge({ status, verdict, failedTest }: { status: SubmissionStatus; verdict: Verdict | null; failedTest?: number | null }) {
  let label: string;
  let cls: string;
  if (status === "queued" || status === "running") {
    label = status === "queued" ? "In queue" : "Judging…";
    cls = tone.neutral;
  } else if (status === "failed" || !verdict) {
    label = "Judge error";
    cls = tone.warn;
  } else {
    label = VERDICT_LABELS[verdict] + (failedTest && verdict !== "compilation_error" ? ` on test ${failedTest}` : "");
    cls = verdict === "accepted" ? tone.good : verdict === "compilation_error" ? tone.warn : tone.bad;
  }
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
