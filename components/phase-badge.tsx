import type { ContestPhase } from "@/lib/contest-phase";

const styles: Record<ContestPhase, string> = {
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  upcoming: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  running: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  ended: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function PhaseBadge({ phase }: { phase: ContestPhase }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[phase]}`}>{phase}</span>;
}
