import Link from "next/link";
import type { SubmissionKind, SubmissionStatus, Verdict } from "@/lib/submissions";
import { LocalTime } from "@/components/time";
import { VerdictBadge } from "@/components/verdict-badge";

export type SubmissionRow = {
  id: string;
  label: string;
  kind: SubmissionKind;
  createdAt: Date;
  status: SubmissionStatus;
  verdict: Verdict | null;
  timeMs: number | null;
  memoryKb: number | null;
  failedTest: number | null;
};

export function SubmissionsTable({ rows, contestSlug, showProblem = true }: { rows: SubmissionRow[]; contestSlug: string; showProblem?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-zinc-600 dark:text-zinc-400">No submissions yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500 dark:text-zinc-400 dark:border-zinc-800">
          <tr>
            <th className="py-2 pr-3 font-medium">When</th>
            {showProblem && <th className="py-2 pr-3 font-medium">Problem</th>}
            <th className="py-2 pr-3 font-medium">Type</th>
            <th className="py-2 pr-3 font-medium">Result</th>
            <th className="py-2 pr-3 font-medium">Time</th>
            <th className="py-2 font-medium">Memory</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className="border-b border-zinc-100 dark:border-zinc-900">
              <td className="py-2 pr-3">
                <Link href={`/contests/${contestSlug}/submissions/${s.id}`} className="hover:underline">
                  <LocalTime iso={s.createdAt.toISOString()} />
                </Link>
              </td>
              {showProblem && <td className="py-2 pr-3 font-medium">{s.label}</td>}
              <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-400">{s.kind === "sample_run" ? "Examples" : "Submit"}</td>
              <td className="py-2 pr-3">
                <VerdictBadge status={s.status} verdict={s.verdict} failedTest={s.failedTest} />
              </td>
              <td className="py-2 pr-3">{s.timeMs != null ? `${s.timeMs} ms` : "—"}</td>
              <td className="py-2">{s.memoryKb != null ? `${Math.round(s.memoryKb / 1024)} MB` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
