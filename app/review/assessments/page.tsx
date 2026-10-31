import { BandBadge } from "@/components/review/badges";
import { LocalTime } from "@/components/time";
import { SubmitButton } from "@/components/ui/form";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { listLatestAssessments } from "@/lib/server/integrity/review";
import { loadOr404 } from "@/lib/server/page-guards";
import { openCaseAction } from "../actions";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "All assessments" };

export default async function AssessmentsPage({ searchParams }: PageProps<"/review/assessments">) {
  const sp = await searchParams;
  const contest = typeof sp.contest === "string" && sp.contest ? sp.contest : undefined;
  const viewer = await loadOr404(requireUser());
  const items = await listLatestAssessments(getDb(), viewer, { contestSlug: contest, limit: 200 });

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">All assessments</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        The latest assessment for every contestant and problem. Elevated scores open a case automatically. Open a case by hand for anything else that deserves
        a human look.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-zinc-500 dark:text-zinc-400 dark:border-zinc-800">
            <tr>
              <th className="py-2 pr-3 font-medium">Contestant</th>
              <th className="py-2 pr-3 font-medium">Contest / problem</th>
              <th className="py-2 pr-3 font-medium">Assessment</th>
              <th className="py-2 pr-3 font-medium">Computed</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2 pr-3">{a.userName}</td>
                <td className="py-2 pr-3">
                  {a.contestTitle} · {a.label}
                </td>
                <td className="py-2 pr-3">
                  <BandBadge band={a.band} score={a.score} />
                </td>
                <td className="py-2 pr-3">
                  <LocalTime iso={a.computedAt.toISOString()} />
                </td>
                <td className="py-2 text-right">
                  <form action={openCaseAction.bind(null, a.id)}>
                    <SubmitButton variant="secondary" pendingLabel="Opening…">
                      Open case
                    </SubmitButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
