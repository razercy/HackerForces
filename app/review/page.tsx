import Link from "next/link";
import { z } from "zod";
import { BandBadge, OutcomeText, StatusBadge } from "@/components/review/badges";
import { LocalTime } from "@/components/time";
import { inputClass } from "@/components/ui/form";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { loadOr404 } from "@/lib/server/page-guards";
import { listCases } from "@/lib/server/review/cases";

const emptyToUndef = (v: unknown) => (v === "" ? undefined : v);
const filtersSchema = z.object({
  contest: z.preprocess(emptyToUndef, z.string().max(64).optional()),
  label: z.preprocess(emptyToUndef, z.string().max(2).optional()),
  contestant: z.preprocess(emptyToUndef, z.string().max(80).optional()),
  status: z.preprocess(emptyToUndef, z.enum(["active", "open", "awaiting_confirmation", "closed"]).optional()),
  band: z.preprocess(emptyToUndef, z.enum(["typical", "elevated", "insufficient_data"]).optional()),
  minScore: z.preprocess(emptyToUndef, z.coerce.number().min(0).max(100).optional()),
  maxScore: z.preprocess(emptyToUndef, z.coerce.number().min(0).max(100).optional()),
  page: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).optional()),
});

export default async function ReviewQueuePage({ searchParams }: PageProps<"/review">) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = filtersSchema.safeParse(raw);
  const f = parsed.success ? parsed.data : {};
  const viewer = await loadOr404(requireUser());
  const { items, total, page, pageSize } = await listCases(getDb(), viewer, {
    contestSlug: f.contest,
    label: f.label,
    contestant: f.contestant,
    status: f.status ?? "active",
    band: f.band,
    minScore: f.minScore,
    maxScore: f.maxScore,
    page: f.page,
  });
  const qs = (p: number) => new URLSearchParams({ ...Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string") as [string, string][]), page: String(p) }).toString();

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Review cases</h1>
      <form method="get" className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-8">
        <input name="contest" placeholder="Contest slug" defaultValue={f.contest} className={`${inputClass} col-span-2`} aria-label="Contest slug" />
        <input name="label" placeholder="Problem" defaultValue={f.label} className={inputClass} aria-label="Problem label" />
        <input name="contestant" placeholder="Contestant" defaultValue={f.contestant} className={`${inputClass} col-span-2`} aria-label="Contestant name" />
        <select name="status" defaultValue={f.status ?? "active"} className={inputClass} aria-label="Status">
          <option value="active">Active</option>
          <option value="open">Requires review</option>
          <option value="awaiting_confirmation">Awaiting confirmation</option>
          <option value="closed">Closed</option>
        </select>
        <select name="band" defaultValue={f.band ?? ""} className={inputClass} aria-label="Band">
          <option value="">Any band</option>
          <option value="elevated">Elevated</option>
          <option value="typical">Typical</option>
          <option value="insufficient_data">Insufficient data</option>
        </select>
        <div className="flex gap-1">
          <input name="minScore" type="number" min={0} max={100} placeholder="min" defaultValue={f.minScore} className={inputClass} aria-label="Minimum score" />
          <input name="maxScore" type="number" min={0} max={100} placeholder="max" defaultValue={f.maxScore} className={inputClass} aria-label="Maximum score" />
        </div>
        <button type="submit" className="col-span-2 rounded-md bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700 sm:col-span-1">
          Filter
        </button>
      </form>
      {!parsed.success && <p className="text-sm text-red-600">Some filters were invalid and were ignored.</p>}

      <p className="text-sm text-zinc-600 dark:text-zinc-400">{total} case(s)</p>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Nothing matches these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="py-2 pr-3 font-medium">Contestant</th>
                <th className="py-2 pr-3 font-medium">Contest / problem</th>
                <th className="py-2 pr-3 font-medium">Assessment</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Last decision</th>
                <th className="py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                  <td className="py-2 pr-3">
                    <Link href={`/review/cases/${c.id}`} className="font-medium hover:underline">
                      {c.userName}
                    </Link>
                    {c.conflictOfInterest && <span className="ml-2 text-xs text-red-600">conflict of interest</span>}
                  </td>
                  <td className="py-2 pr-3">
                    {c.contestTitle} · {c.label}
                  </td>
                  <td className="py-2 pr-3">
                    <BandBadge band={c.band} score={c.score} />
                    {c.newAssessmentSinceDecision && <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">new since decision</span>}
                  </td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="py-2 pr-3">{c.lastOutcome ? <OutcomeText outcome={c.lastOutcome} /> : "—"}</td>
                  <td className="py-2">
                    <LocalTime iso={c.updatedAt.toISOString()} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav aria-label="Pagination" className="flex gap-3 text-sm">
        {page > 1 && (
          <Link href={`/review?${qs(page - 1)}`} className="underline">
            Previous
          </Link>
        )}
        {page * pageSize < total && (
          <Link href={`/review?${qs(page + 1)}`} className="underline">
            Next
          </Link>
        )}
      </nav>
    </section>
  );
}
