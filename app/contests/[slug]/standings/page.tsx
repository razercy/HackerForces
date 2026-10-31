import Link from "next/link";
import { PhaseBadge } from "@/components/phase-badge";
import { getCurrentUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { loadOr404 } from "@/lib/server/page-guards";
import { PENALTY_MINUTES, getStandings } from "@/lib/server/services/submissions";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Standings" };

export default async function StandingsPage({ params }: PageProps<"/contests/[slug]/standings">) {
  const { slug } = await params;
  const viewer = await getCurrentUser();
  const { contest, rows } = await loadOr404(getStandings(getDb(), viewer, slug));

  return (
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-8">
      <nav className="text-sm text-zinc-500 dark:text-zinc-400">
        <Link href={`/contests/${contest.slug}`} className="hover:underline">
          {contest.title}
        </Link>
      </nav>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Standings</h1>
        <PhaseBadge phase={contest.phase} />
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Ranked by problems solved, then penalty: minutes to each accepted solution plus {PENALTY_MINUTES} minutes per earlier rejected attempt.
        Compilation errors and example runs are not penalised. ✕ / †: a problem excluded after a human integrity review confirmed by a second reviewer.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{contest.phase === "upcoming" ? "Standings appear when the contest starts." : "No participants yet."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500 dark:text-zinc-400 dark:border-zinc-800">
              <tr>
                <th className="py-2 pr-3 text-left font-medium">#</th>
                <th className="py-2 pr-3 text-left font-medium">Contestant</th>
                <th className="py-2 pr-3 text-right font-medium">Solved</th>
                <th className="py-2 pr-3 text-right font-medium">Penalty</th>
                {contest.labels.map((l) => (
                  <th key={l} className="w-16 py-2 text-center font-medium">
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId} className={`border-b border-zinc-100 dark:border-zinc-900 ${viewer?.userId === r.userId ? "bg-blue-50 dark:bg-blue-950/40" : ""}`}>
                  <td className="py-2 pr-3">{r.rank}</td>
                  <td className="py-2 pr-3">
                    {r.name}
                    {r.hasExclusion && (
                      <sup className="ml-1 text-zinc-500 dark:text-zinc-400" title="One or more problems excluded after integrity review">
                        †
                      </sup>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right font-medium">{r.solved}</td>
                  <td className="py-2 pr-3 text-right">{r.penalty}</td>
                  {contest.labels.map((l) => {
                    const c = r.cells[l];
                    if (!c) return <td key={l} />;
                    if (c.excluded)
                      return (
                        <td key={l} className="py-2 text-center text-zinc-400" title="Excluded after integrity review">
                          ✕
                        </td>
                      );
                    return (
                      <td key={l} className="py-2 text-center">
                        {c.solved ? (
                          <span className="font-medium text-green-700 dark:text-green-400" title={`Solved at minute ${c.solvedAtMinute}`}>
                            +{c.rejected || ""}
                            <span className="block text-[10px] font-normal text-zinc-500 dark:text-zinc-400">{c.solvedAtMinute}′</span>
                          </span>
                        ) : c.rejected > 0 ? (
                          <span className="text-red-600 dark:text-red-400">−{c.rejected}</span>
                        ) : c.pending ? (
                          <span className="text-zinc-400">?</span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
