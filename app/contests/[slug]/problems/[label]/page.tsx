import Link from "next/link";
import { Workspace } from "@/components/editor/workspace";
import { Markdown } from "@/components/markdown";
import { SubmissionsTable } from "@/components/submissions-table";
import { getCurrentUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { loadOr404 } from "@/lib/server/page-guards";
import { getContestProblemForViewer } from "@/lib/server/services/contests";
import { listOwnSubmissions } from "@/lib/server/services/submissions";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function ProblemPage({ params }: PageProps<"/contests/[slug]/problems/[label]">) {
  const { slug, label } = await params;
  const viewer = await getCurrentUser();
  const { contest, problem, examples } = await loadOr404(getContestProblemForViewer(getDb(), viewer, slug, label));
  const mine = viewer ? await listOwnSubmissions(getDb(), viewer, contest.slug, { label: problem.label, limit: 20 }) : [];
  const canSubmit = !!viewer && contest.isRegistered && !contest.needsAcknowledgement && contest.phase === "running";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <nav className="text-sm text-zinc-500">
        <Link href={`/contests/${contest.slug}`} className="hover:underline">
          {contest.title}
        </Link>
      </nav>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {problem.label}. {problem.title}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Time limit: {problem.timeLimitMs / 1000} s · Memory limit: {problem.memoryLimitMb} MB
        </p>
      </header>

      <Markdown>{problem.statement}</Markdown>
      <Block title="Input">
        <Markdown>{problem.inputFormat}</Markdown>
      </Block>
      <Block title="Output">
        <Markdown>{problem.outputFormat}</Markdown>
      </Block>
      {problem.constraints && (
        <Block title="Constraints">
          <Markdown>{problem.constraints}</Markdown>
        </Block>
      )}
      {examples.length > 0 && (
        <Block title="Examples">
          {examples.map((ex) => (
            <div key={ex.ordinal} className="flex flex-col gap-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-zinc-500">Input</p>
                  <pre className="overflow-x-auto rounded-md bg-zinc-50 p-3 font-mono text-xs dark:bg-zinc-900">{ex.input}</pre>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">Output</p>
                  <pre className="overflow-x-auto rounded-md bg-zinc-50 p-3 font-mono text-xs dark:bg-zinc-900">{ex.output}</pre>
                </div>
              </div>
              {ex.explanation && <Markdown>{ex.explanation}</Markdown>}
            </div>
          ))}
        </Block>
      )}
      {problem.notes && (
        <Block title="Notes">
          <Markdown>{problem.notes}</Markdown>
        </Block>
      )}
      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Solve</h2>
        {canSubmit ? (
          <Workspace contestSlug={contest.slug} label={problem.label} noticeHref={`/contests/${contest.slug}#activity-notice`} />
        ) : (
          <p className="rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            {!viewer ? (
              <>
                <Link href="/sign-in" className="underline">
                  Sign in
                </Link>{" "}
                and register to submit.
              </>
            ) : contest.phase === "ended" ? (
              "The contest has ended. Submissions are closed."
            ) : contest.needsAcknowledgement ? (
              <>
                <Link href={`/contests/${contest.slug}#activity-notice`} className="underline">
                  Accept the activity-recording notice
                </Link>{" "}
                to use the editor.
              </>
            ) : (
              <>
                <Link href={`/contests/${contest.slug}`} className="underline">
                  Register for the contest
                </Link>{" "}
                to submit.
              </>
            )}
          </p>
        )}
      </section>

      {viewer && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Your submissions for {problem.label}</h2>
          <SubmissionsTable rows={mine} contestSlug={contest.slug} showProblem={false} />
        </section>
      )}
    </main>
  );
}
