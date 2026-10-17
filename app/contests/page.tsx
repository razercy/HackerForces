import Link from "next/link";
import { PhaseBadge } from "@/components/phase-badge";
import { LocalTime } from "@/components/time";
import { getDb } from "@/lib/server/db";
import { listPublicContests } from "@/lib/server/services/contests";

export const dynamic = "force-dynamic";

export default async function ContestsPage() {
  const contests = await listPublicContests(getDb());
  const groups = [
    { title: "Running", items: contests.filter((c) => c.phase === "running") },
    { title: "Upcoming", items: contests.filter((c) => c.phase === "upcoming").reverse() },
    { title: "Past", items: contests.filter((c) => c.phase === "ended") },
  ];
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-8">
      <h1 className="text-2xl font-semibold">Contests</h1>
      {contests.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">No contests have been published yet.</p>}
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.title} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{g.title}</h2>
            <ul className="flex flex-col divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
              {g.items.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div>
                    <Link href={`/contests/${c.slug}`} className="font-medium hover:underline">
                      {c.title}
                    </Link>
                    <p className="text-xs text-zinc-500">
                      <LocalTime iso={c.startsAt.toISOString()} /> – <LocalTime iso={c.endsAt.toISOString()} />
                    </p>
                  </div>
                  <PhaseBadge phase={c.phase} />
                </li>
              ))}
            </ul>
          </section>
        ))}
    </main>
  );
}
