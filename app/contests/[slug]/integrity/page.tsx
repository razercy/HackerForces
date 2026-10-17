import Link from "next/link";
import { TextForm } from "@/components/review/forms";
import { LocalTime } from "@/components/time";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { loadOr404 } from "@/lib/server/page-guards";
import { getContestantNotices } from "@/lib/server/review/cases";
import { getContestForViewer } from "@/lib/server/services/contests";
import { submitResponseAction } from "./actions";

/** The contestant's own view of integrity decisions that took effect for them. Neutral; reviewer identities are withheld. */
export default async function IntegrityNoticePage({ params }: PageProps<"/contests/[slug]/integrity">) {
  const { slug } = await params;
  const viewer = await loadOr404(requireUser());
  const c = await loadOr404(getContestForViewer(getDb(), viewer, slug));
  const notices = await getContestantNotices(getDb(), viewer, c.id);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
      <nav className="text-sm text-zinc-500">
        <Link href={`/contests/${c.slug}`} className="hover:underline">
          {c.title}
        </Link>
      </nav>
      <h1 className="text-2xl font-semibold">Integrity review decisions</h1>
      {notices.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">There are no integrity decisions about your participation in this contest.</p>
      ) : (
        notices.map((n) => (
          <section key={n.decisionId} className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="font-semibold">
              Problem {n.label}. {n.problemTitle}
            </h2>
            <p className="text-sm">
              After human review, and confirmation by a second, independent reviewer on <LocalTime iso={n.confirmedAt.toISOString()} />, your solution to this
              problem was found not to comply with the contest rules.{" "}
              {n.inEffect ? "It is currently excluded from the standings." : "This decision has since been reversed and no longer applies."}
            </p>
            <div className="rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
              <p className="text-xs font-medium text-zinc-500">Reason given</p>
              <p className="mt-1 whitespace-pre-wrap">{n.rationale}</p>
            </div>
            {n.responses.length > 0 && (
              <div className="flex flex-col gap-2 text-sm">
                <p className="text-xs font-medium text-zinc-500">Your responses</p>
                {n.responses.map((r) => (
                  <blockquote key={r.id} className="border-l-2 border-zinc-300 pl-3 dark:border-zinc-700">
                    <p className="whitespace-pre-wrap">{r.body}</p>
                    <footer className="text-xs text-zinc-500">
                      <LocalTime iso={r.createdAt.toISOString()} />
                    </footer>
                  </blockquote>
                ))}
              </div>
            )}
            <TextForm action={submitResponseAction.bind(null, n.caseId)} name="body" label="Your response (visible to the review team)" submitLabel="Send response" rows={4} />
          </section>
        ))
      )}
    </main>
  );
}
