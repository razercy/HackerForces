import Link from "next/link";
import { notFound } from "next/navigation";
import { AttachProblemForm, ContestForm, StatusActionButton } from "@/components/manage/contest-forms";
import { PhaseBadge } from "@/components/phase-badge";
import { SubmitButton } from "@/components/ui/form";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { loadOr404 } from "@/lib/server/page-guards";
import { getContestForManagement } from "@/lib/server/services/contests";
import { listManageableProblems } from "@/lib/server/services/problems";
import { isUuid } from "@/lib/validation/ids";
import {
  attachProblemAction,
  detachProblemAction,
  publishContestAction,
  unpublishContestAction,
  updateContestAction,
} from "../actions";

function nextLabel(used: string[]): string {
  for (let i = 0; i < 26; i++) {
    const l = String.fromCharCode(65 + i);
    if (!used.includes(l)) return l;
  }
  return "";
}

export default async function EditContestPage({ params }: PageProps<"/manage/contests/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const user = await requireUser();
  const [c, problems] = await loadOr404(Promise.all([getContestForManagement(getDb(), user, id), listManageableProblems(getDb(), user)]));
  const attached = new Set(c.problems.map((p) => p.problemId));
  const editable = c.phase === "draft" || c.phase === "upcoming";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <PhaseBadge phase={c.phase} />
        {c.status === "published" && (
          <Link href={`/contests/${c.slug}`} className="text-sm underline">
            View public page
          </Link>
        )}
        <span className="text-sm text-zinc-500">{c.participants} registered</span>
      </div>

      <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Publishing</h2>
        {c.status === "draft" ? (
          <>
            {c.readiness.length > 0 ? (
              <ul className="list-disc pl-5 text-sm text-amber-700 dark:text-amber-400">
                {c.readiness.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-green-700 dark:text-green-400">Ready to publish.</p>
            )}
            <StatusActionButton action={publishContestAction.bind(null, c.id)} label="Publish" variant="primary" />
          </>
        ) : c.phase === "upcoming" ? (
          <StatusActionButton action={unpublishContestAction.bind(null, c.id)} label="Move back to draft" variant="secondary" />
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">The contest has started. The problem set and start time are locked.</p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Problems</h2>
        {c.problems.length > 0 && (
          <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
            {c.problems.map((p) => (
              <li key={p.problemId} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span>
                  <strong className="mr-2">{p.label}</strong>
                  <Link href={`/manage/problems/${p.problemId}`} className="hover:underline">
                    {p.title}
                  </Link>
                </span>
                {editable && (
                  <form action={detachProblemAction.bind(null, c.id, p.problemId)}>
                    <SubmitButton variant="danger" pendingLabel="Removing…">
                      Remove
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <AttachProblemForm
            action={attachProblemAction.bind(null, c.id)}
            options={problems.filter((p) => !attached.has(p.id))}
            suggestedLabel={nextLabel(c.problems.map((p) => p.label))}
          />
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Details</h2>
        <ContestForm
          action={updateContestAction.bind(null, c.id)}
          defaults={{ slug: c.slug, title: c.title, description: c.description, startsAt: c.startsAt.toISOString(), endsAt: c.endsAt.toISOString() }}
          submitLabel="Save changes"
        />
      </section>
    </div>
  );
}
