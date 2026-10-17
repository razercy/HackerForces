import Link from "next/link";
import { Markdown } from "@/components/markdown";
import { PhaseBadge } from "@/components/phase-badge";
import { RegisterButton } from "@/components/register-button";
import { LocalTime } from "@/components/time";
import { getCurrentUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { loadOr404 } from "@/lib/server/page-guards";
import { getContestForViewer } from "@/lib/server/services/contests";
import { registerAction } from "../actions";

export default async function ContestPage({ params }: PageProps<"/contests/[slug]">) {
  const { slug } = await params;
  const viewer = await getCurrentUser();
  const c = await loadOr404(getContestForViewer(getDb(), viewer, slug));

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{c.title}</h1>
          <PhaseBadge phase={c.phase} />
          {c.isManager && <span className="text-xs text-zinc-500">You manage this contest</span>}
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <LocalTime iso={c.startsAt.toISOString()} /> – <LocalTime iso={c.endsAt.toISOString()} />
        </p>
      </header>

      {c.description && <Markdown>{c.description}</Markdown>}

      <section>
        {c.isRegistered ? (
          <p className="text-sm text-green-700 dark:text-green-400">You are registered for this contest.</p>
        ) : c.canRegister ? (
          <RegisterButton action={registerAction.bind(null, c.id)} />
        ) : !viewer && c.phase !== "ended" ? (
          <p className="text-sm">
            <Link href="/sign-in" className="underline">
              Sign in
            </Link>{" "}
            to register.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Problems</h2>
        {!c.problemsVisible ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Problems become visible when the contest starts.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
            {c.problems.map((p) => (
              <li key={p.label} className="px-4 py-3">
                <Link href={`/contests/${c.slug}/problems/${p.label}`} className="hover:underline">
                  <strong className="mr-2">{p.label}</strong>
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
