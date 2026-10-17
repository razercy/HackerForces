import { NewTemplateForm, TemplateVersionForm } from "@/components/template-forms";
import { LocalTime } from "@/components/time";
import { SubmitButton } from "@/components/ui/form";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { loadOr404 } from "@/lib/server/page-guards";
import { listOwnTemplates } from "@/lib/server/services/templates";
import { archiveTemplateAction, createTemplateAction, saveVersionAction } from "./actions";

export default async function TemplatesPage() {
  const user = await loadOr404(requireUser());
  const templates = await listOwnTemplates(getDb(), user);
  const active = templates.filter((t) => !t.archivedAt);
  const archived = templates.filter((t) => t.archivedAt);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">My templates</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Register code you routinely reuse (fast I/O, data structures, your usual boilerplate). Code in your contest submissions that matches a registered template is
          treated as legitimate reuse and is not counted as pasted code.
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <strong>Templates are frozen when a contest starts:</strong> for each contest, the version that applies is the latest one you saved before it began. Edits
          and new templates made during a contest only apply to later contests. Every version is kept with its save time and SHA-256.
        </p>
      </header>

      {active.map((t) => (
        <section key={t.id} className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t.name}</h2>
            <form action={archiveTemplateAction.bind(null, t.id)}>
              <SubmitButton variant="danger" pendingLabel="Archiving…">
                Archive
              </SubmitButton>
            </form>
          </div>
          <TemplateVersionForm action={saveVersionAction.bind(null, t.id)} templateId={t.id} source={t.latest?.source ?? ""} />
          <details className="text-xs text-zinc-600 dark:text-zinc-400">
            <summary className="cursor-pointer">
              {t.versionCount} version{t.versionCount === 1 ? "" : "s"}
            </summary>
            <ul className="mt-2 flex flex-col gap-1 font-mono">
              {t.history.map((v) => (
                <li key={v.id}>
                  <LocalTime iso={v.createdAt.toISOString()} /> · {v.sourceSha256.slice(0, 16)}…
                </li>
              ))}
            </ul>
          </details>
        </section>
      ))}

      <section className="flex flex-col gap-3 rounded-lg border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
        <h2 className="font-semibold">New template</h2>
        <NewTemplateForm action={createTemplateAction} />
      </section>

      {archived.length > 0 && (
        <section className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Archived</h2>
          {archived.map((t) => (
            <p key={t.id}>
              {t.name}: archived <LocalTime iso={t.archivedAt!.toISOString()} />. Still applies to contests that started before then.
            </p>
          ))}
        </section>
      )}
    </main>
  );
}
