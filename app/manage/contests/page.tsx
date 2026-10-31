import Link from "next/link";
import { PhaseBadge } from "@/components/phase-badge";
import { LocalTime } from "@/components/time";
import { contestPhase } from "@/lib/contest-phase";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { loadOr404 } from "@/lib/server/page-guards";
import { listManageableContests } from "@/lib/server/services/contests";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Manage contests" };

export default async function ManageContestsPage() {
  const contests = await loadOr404(requireUser().then((u) => listManageableContests(getDb(), u)));
  const now = new Date();
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Contests</h1>
        <Link href="/manage/contests/new" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          New contest
        </Link>
      </div>
      {contests.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">No contests yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
          {contests.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <Link href={`/manage/contests/${c.id}`} className="font-medium hover:underline">
                  {c.title}
                </Link>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  <LocalTime iso={c.startsAt.toISOString()} /> – <LocalTime iso={c.endsAt.toISOString()} />
                </p>
              </div>
              <PhaseBadge phase={contestPhase(c, now)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
