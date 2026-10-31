import type { Metadata } from "next";
import { AddExampleForm, AddTestForm, ReferenceSolutionForm } from "@/components/manage/problem-data-forms";
import { ProblemForm } from "@/components/manage/problem-form";
import { SubmitButton } from "@/components/ui/form";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { loadOr404 } from "@/lib/server/page-guards";
import { getProblemForManagement } from "@/lib/server/services/problems";
import { isUuid } from "@/lib/validation/ids";
import {
  addExampleAction,
  addTestAction,
  deleteExampleAction,
  deleteTestAction,
  setReferenceSolutionAction,
  updateProblemAction,
} from "../actions";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-zinc-600 dark:text-zinc-400">{description}</p>}
      </div>
      {children}
    </section>
  );
}

const kb = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

export const metadata: Metadata = { title: "Edit problem" };

export default async function EditProblemPage({ params }: PageProps<"/manage/problems/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const p = await loadOr404(requireUser().then((u) => getProblemForManagement(getDb(), u, id)));
  const cpp = p.referenceSolutions.find((r) => r.language === "cpp17");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{p.title}</h1>

      <Section title="Statement and limits">
        <ProblemForm action={updateProblemAction.bind(null, p.id)} defaults={p} submitLabel="Save changes" />
      </Section>

      <Section title="Examples" description="Shown to contestants in the statement.">
        {p.examples.length > 0 && (
          <ol className="flex flex-col gap-2">
            {p.examples.map((ex) => (
              <li key={ex.id} className="flex items-start justify-between gap-4 rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
                <div className="grid flex-1 gap-2 sm:grid-cols-2">
                  <pre className="overflow-x-auto font-mono text-xs">{ex.input}</pre>
                  <pre className="overflow-x-auto font-mono text-xs">{ex.output}</pre>
                </div>
                <form action={deleteExampleAction.bind(null, p.id, ex.id)}>
                  <SubmitButton variant="danger" pendingLabel="Removing…">
                    Remove
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ol>
        )}
        <AddExampleForm action={addExampleAction.bind(null, p.id)} />
      </Section>

      <Section title="Hidden tests" description="Never shown to contestants. Bodies are previewed here, not displayed in full.">
        {p.tests.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-1 font-medium">#</th>
                <th className="py-1 font-medium">Input</th>
                <th className="py-1 font-medium">Expected output</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {p.tests.map((t) => (
                <tr key={t.id} className="border-t border-zinc-100 align-top dark:border-zinc-900">
                  <td className="py-2">{t.ordinal}</td>
                  <td className="py-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{kb(t.inputBytes)}</span>
                    <pre className="max-w-xs truncate font-mono text-xs">{t.inputPreview}</pre>
                  </td>
                  <td className="py-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{kb(t.outputBytes)}</span>
                    <pre className="max-w-xs truncate font-mono text-xs">{t.outputPreview}</pre>
                  </td>
                  <td className="py-2 text-right">
                    <form action={deleteTestAction.bind(null, p.id, t.id)}>
                      <SubmitButton variant="danger" pendingLabel="Deleting…">
                        Delete
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <AddTestForm action={addTestAction.bind(null, p.id)} />
      </Section>

      <Section title="Reference solution" description="Hidden. Required before the problem can appear in a published contest.">
        <ReferenceSolutionForm action={setReferenceSolutionAction.bind(null, p.id)} defaultSource={cpp?.source} />
      </Section>
    </div>
  );
}
