import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/time";
import { VerdictBadge } from "@/components/verdict-badge";
import { LANGUAGE_LABELS } from "@/lib/languages";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { loadOr404 } from "@/lib/server/page-guards";
import { getSubmissionForViewer } from "@/lib/server/services/submissions";

export default async function SubmissionPage({ params }: PageProps<"/contests/[slug]/submissions/[id]">) {
  const { slug, id } = await params;
  const viewer = await loadOr404(requireUser());
  const s = await loadOr404(getSubmissionForViewer(getDb(), viewer, id));
  if (s.contestSlug !== slug) notFound();

  const facts: [string, React.ReactNode][] = [
    ["Problem", `${s.label ?? "?"}. ${s.problemTitle}`],
    ["Author", s.authorName],
    ["Type", s.kind === "sample_run" ? "Example run (does not count)" : "Submission"],
    ["Language", LANGUAGE_LABELS[s.language]],
    ["Submitted", <LocalTime key="t" iso={s.createdAt.toISOString()} />],
    ["Tests", s.totalTests != null && s.verdict !== "compilation_error" ? `${s.passedTests}/${s.totalTests} passed` : "—"],
    ["Time", s.timeMs != null ? `${s.timeMs} ms` : "—"],
    ["Memory", s.memoryKb != null ? `${Math.round(s.memoryKb / 1024)} MB` : "—"],
  ];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <nav className="text-sm text-zinc-500">
        <Link href={`/contests/${s.contestSlug}`} className="hover:underline">
          {s.contestTitle}
        </Link>
        {s.isOwner && (
          <>
            {" / "}
            <Link href={`/contests/${s.contestSlug}/submissions`} className="hover:underline">
              My submissions
            </Link>
          </>
        )}
      </nav>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Submission</h1>
        <VerdictBadge status={s.status} verdict={s.verdict} failedTest={s.failedTest} />
      </header>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {facts.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-24 shrink-0 text-zinc-500">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      {s.compileOutput && (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Compiler output</h2>
          <pre className="max-h-72 overflow-auto rounded-md bg-zinc-50 p-3 font-mono text-xs dark:bg-zinc-900">{s.compileOutput}</pre>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Source</h2>
        <pre className="max-h-[36rem] overflow-auto rounded-md bg-zinc-50 p-3 font-mono text-xs leading-5 dark:bg-zinc-900">{s.source}</pre>
        <p className="font-mono text-xs break-all text-zinc-500">SHA-256 {s.sourceSha256}</p>
      </section>
    </main>
  );
}
