import Link from "next/link";
import { notFound } from "next/navigation";
import { BandBadge, OutcomeText, StatusBadge } from "@/components/review/badges";
import { DiffView } from "@/components/review/diff-view";
import { ConfirmForm, DecisionForm, TextForm } from "@/components/review/forms";
import { DocLengthChart, EventTable } from "@/components/review/timeline";
import { LocalTime } from "@/components/time";
import { VerdictBadge } from "@/components/verdict-badge";
import type { Features } from "@/lib/integrity/features";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { getAssessment } from "@/lib/server/integrity/review";
import { loadOr404 } from "@/lib/server/page-guards";
import { getCase, listSubjectSubmissions, templatesInEffectFor } from "@/lib/server/review/cases";
import { getSessionTimeline } from "@/lib/server/telemetry/timeline";
import { isUuid } from "@/lib/validation/ids";
import type { SubmissionStatus, Verdict } from "@/lib/submissions";
import { addNoteAction, confirmDecisionAction, recordDecisionAction, reopenCaseAction } from "../../actions";
import type { Metadata } from "next";

type Contribution = { feature: keyof Features; label: string; value: number | null; weight: number; contribution: number; points: number; mode: string; reference: Record<string, number> | null };
type Warning = { code: string; message: string; severity?: string };

function Panel({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export const metadata: Metadata = { title: "Review case" };

export default async function CasePage({ params, searchParams }: PageProps<"/review/cases/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const viewer = await loadOr404(requireUser());
  const db = getDb();
  const c = await loadOr404(getCase(db, viewer, id));
  const [assessment, submissions, templates] = await Promise.all([
    c.latestAssessmentId ? getAssessment(db, viewer, c.latestAssessmentId) : Promise.resolve(null),
    listSubjectSubmissions(db, viewer, c.subject),
    templatesInEffectFor(db, viewer, c.subject),
  ]);

  const target = (assessment?.dataQuality as { target?: { submissionId: string } } | undefined)?.target;
  const targetSubmission = submissions.find((s) => s.id === target?.submissionId) ?? null;
  const sessions = assessment?.sessions ?? [];
  const sessionParam = one(sp.session);
  // Default: the assessed submission's session, else the session with the most activity.
  const busiest = [...sessions].sort((a, b) => b.receivedCount - a.receivedCount)[0];
  const sessionId = sessions.find((s) => s.id === sessionParam)?.id ?? targetSubmission?.ideSessionId ?? busiest?.id ?? null;
  const timeline = sessionId ? await getSessionTimeline(db, viewer, sessionId) : null;
  const allEvents = one(sp.events) === "all";

  // Code evolution: any snapshot (or the submitted code) against any other.
  const versions = [
    ...(timeline?.snapshots ?? []).map((s) => ({ key: String(s.seq), label: `seq ${s.seq} (${s.reason ?? "snapshot"})`, source: s.source })),
    ...(targetSubmission && targetSubmission.ideSessionId === sessionId ? [{ key: "submitted", label: "submitted code", source: targetSubmission.source }] : []),
  ];
  const fromV = versions.find((v) => v.key === one(sp.from)) ?? versions[0];
  const toV = versions.find((v) => v.key === one(sp.to)) ?? versions.at(-1);
  const link = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ ...(sessionId ? { session: sessionId } : {}), ...(fromV ? { from: fromV.key } : {}), ...(toV ? { to: toV.key } : {}), ...(allEvents ? { events: "all" } : {}), ...patch });
    return `/review/cases/${c.id}?${q}`;
  };

  const contributions = (assessment?.contributions ?? []) as Contribution[];
  const warnings = (assessment?.warnings ?? []) as Warning[];
  const p = c.permissions;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <nav className="text-sm text-zinc-500 dark:text-zinc-400">
          <Link href="/review" className="hover:underline">
            Cases
          </Link>
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {c.subject.userName} · {c.subject.contestTitle} · {c.subject.label}. {c.subject.problemTitle}
          </h1>
          <StatusBadge status={c.status} />
          <BandBadge band={assessment?.band ?? null} score={assessment?.score} />
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Opened <LocalTime iso={c.createdAt.toISOString()} /> ({c.openedReason === "manual" ? "manually" : "automatically for an elevated assessment"}) ·{" "}
          {assessment ? `${assessment.rulesetVersion} / ${assessment.featureSetVersion} · inputs ${assessment.inputsDigest.slice(0, 12)}…` : "no assessment yet"}
        </p>
        {p.conflictOfInterest && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">
            You have a conflict of interest (this is your own work or a contest you created). You can read this case but cannot act on it.
          </p>
        )}
      </header>

      {warnings.length > 0 && (
        <Panel title="Data-quality warnings (read first)">
          <ul className="list-disc pl-5 text-sm">
            {warnings.map((w, i) => (
              <li key={i} className={w.severity === "warning" ? "text-amber-800 dark:text-amber-300" : ""}>
                {w.message} <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">({w.code})</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {assessment && (
        <Panel title="Why this score">
          {assessment.explanations.length > 0 ? (
            <ul className="list-disc pl-5 text-sm">
              {assessment.explanations.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">No signal contributed to the score.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="py-1 pr-3 font-medium">Signal</th>
                  <th className="py-1 pr-3 font-medium">Value</th>
                  <th className="py-1 pr-3 font-medium">Reference</th>
                  <th className="py-1 pr-3 font-medium">Weight</th>
                  <th className="py-1 font-medium">Points</th>
                </tr>
              </thead>
              <tbody>
                {contributions.map((k) => (
                  <tr key={k.feature} className="border-t border-zinc-100 dark:border-zinc-900">
                    <td className="py-1 pr-3">
                      <span className="font-mono">{k.feature}</span>
                      <span className="block text-zinc-500 dark:text-zinc-400">{assessment.features[k.feature]?.explanation}</span>
                    </td>
                    <td className="py-1 pr-3 font-mono">{k.value ?? "n/a"}</td>
                    <td className="py-1 pr-3 font-mono">
                      {k.mode === "unavailable"
                        ? "unavailable"
                        : k.reference && "median" in k.reference
                          ? `median ${k.reference.median}, z ${k.reference.z} (n=${k.reference.n})`
                          : k.reference
                            ? `prior ${k.reference.start} → ${k.reference.full}`
                            : ""}
                    </td>
                    <td className="py-1 pr-3 font-mono">{k.weight}</td>
                    <td className="py-1 font-mono">{k.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">All features and evidence pointers</summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded bg-zinc-50 p-2 dark:bg-zinc-900">{JSON.stringify({ features: assessment.features, evidence: assessment.evidence, dataQuality: assessment.dataQuality }, null, 2)}</pre>
          </details>
          {assessment.history.length > 1 && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Score history: {assessment.history.map((h) => (h.score == null ? "n/a" : h.score)).join(" ← ")} (newest first)
            </p>
          )}
        </Panel>
      )}

      <Panel title="Templates in effect">
        <ul className="text-sm">
          {templates.map((t) => (
            <li key={t.kind + t.sourceSha256}>
              <span className="text-xs uppercase text-zinc-500 dark:text-zinc-400">{t.kind}</span> {t.name} <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{t.sourceSha256.slice(0, 12)}…</span>
            </li>
          ))}
        </ul>
        {assessment && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Template coverage of the assessed submission: {Math.round((assessment.features.template_coverage?.value ?? 0) * 100)}%</p>
        )}
      </Panel>

      <Panel title="Editor activity" id="timeline">
        {sessions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No editor sessions for this problem.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              {sessions.map((s, i) => (
                <Link key={s.id} href={link({ session: s.id })} className={`rounded border px-2 py-1 ${s.id === sessionId ? "border-blue-600 bg-blue-50 dark:bg-blue-950/40" : "border-zinc-300 dark:border-zinc-700"}`}>
                  Session {i + 1} · <LocalTime iso={s.startedAt.toISOString()} /> · {s.receivedCount} events{s.purgedAt ? " · purged" : ""}
                </Link>
              ))}
            </div>
            {timeline && (
              <>
                <DocLengthChart events={timeline.events} />
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {timeline.summary.typedChars} typed · {timeline.summary.pastedChars} pasted ({timeline.summary.pasteCount} pastes) · {timeline.summary.undoCount} undos · {timeline.summary.runs} runs ·{" "}
                  {timeline.summary.submits} submits
                </p>
                <div className="flex items-center gap-3 text-xs">
                  <span>{allEvents ? "All events" : "Notable events and gaps"}</span>
                  <Link href={link({ events: allEvents ? "notable" : "all" })} className="underline">
                    {allEvents ? "Show notable only" : "Show all"}
                  </Link>
                </div>
                <EventTable events={timeline.events} all={allEvents} />
              </>
            )}
          </>
        )}
      </Panel>

      {versions.length >= 2 && fromV && toV && (
        <Panel title="Code evolution">
          <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
            {sessionId && <input type="hidden" name="session" value={sessionId} />}
            <label className="flex flex-col gap-1">
              From
              <select name="from" defaultValue={fromV.key} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900">
                {versions.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              To
              <select name="to" defaultValue={toV.key} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900">
                {versions.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700">
              Compare
            </button>
          </form>
          <DiffView before={fromV.source} after={toV.source} beforeLabel={fromV.label} afterLabel={toV.label} />
        </Panel>
      )}

      <Panel title="Submissions">
        <ul className="flex flex-col gap-2 text-sm">
          {submissions.map((s) => (
            <li key={s.id} className="flex flex-col gap-1 border-t border-zinc-100 pt-2 first:border-0 first:pt-0 dark:border-zinc-900">
              <div className="flex flex-wrap items-center gap-3">
                <LocalTime iso={s.createdAt.toISOString()} />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{s.kind === "sample_run" ? "examples" : "submit"}</span>
                <VerdictBadge status={s.status as SubmissionStatus} verdict={s.verdict as Verdict | null} failedTest={s.failedTest} />
                {s.id === targetSubmission?.id && <span className="text-xs font-medium">assessed</span>}
                {!s.ideSessionId && <span className="text-xs text-amber-700 dark:text-amber-400">not from the editor</span>}
                <Link href={`/contests/${c.subject.contestSlug}/submissions/${s.id}`} className="text-xs underline">
                  source
                </Link>
              </div>
              {s.compileOutput && <pre className="max-h-24 overflow-auto rounded bg-zinc-50 p-2 font-mono text-xs dark:bg-zinc-900">{s.compileOutput}</pre>}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Decisions">
        {c.decisions.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">No decision yet.</p>}
        <ol className="flex flex-col gap-3 text-sm">
          {c.decisions.map((d) => (
            <li key={d.id} className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
              <p>
                <OutcomeText outcome={d.outcome} /> by {d.reviewerName} · <LocalTime iso={d.createdAt.toISOString()} />
              </p>
              <p className="mt-1 whitespace-pre-wrap">{d.rationale}</p>
              {d.confirmation && (
                <p className="mt-2 text-xs">
                  {d.confirmation.verdict === "confirmed" ? "Confirmed" : "Rejected"} by {d.confirmation.adminName} · <LocalTime iso={d.confirmation.createdAt.toISOString()} />: {d.confirmation.rationale}
                </p>
              )}
            </li>
          ))}
        </ol>
        {p.canDecide && <DecisionForm action={recordDecisionAction.bind(null, c.id)} assessmentId={c.latestAssessmentId} />}
        {c.status === "awaiting_confirmation" &&
          (p.canConfirm ? (
            <ConfirmForm action={confirmDecisionAction.bind(null, c.id)} />
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Waiting for a different admin to confirm or reject the violation decision.</p>
          ))}
        {p.canReopen && <TextForm action={reopenCaseAction.bind(null, c.id)} name="reason" label="Reopen with a reason" submitLabel="Reopen case" />}
      </Panel>

      {c.responses.length > 0 && (
        <Panel title="Contestant responses">
          {c.responses.map((r) => (
            <blockquote key={r.id} className="border-l-2 border-zinc-300 pl-3 text-sm dark:border-zinc-700">
              <p className="whitespace-pre-wrap">{r.body}</p>
              <footer className="text-xs text-zinc-500 dark:text-zinc-400">
                <LocalTime iso={r.createdAt.toISOString()} />
              </footer>
            </blockquote>
          ))}
        </Panel>
      )}

      <Panel title="Notes">
        {c.notes.map((n) => (
          <p key={n.id} className="text-sm">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {n.authorName} · <LocalTime iso={n.createdAt.toISOString()} />
            </span>
            <span className="block whitespace-pre-wrap">{n.body}</span>
          </p>
        ))}
        {p.canNote && <TextForm action={addNoteAction.bind(null, c.id)} name="body" label="Add a note (reviewers only)" submitLabel="Add note" />}
      </Panel>
    </div>
  );
}
