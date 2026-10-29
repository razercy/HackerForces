import { redirect } from "next/navigation";
import { LocalTime } from "@/components/time";
import { SubmitButton } from "@/components/ui/form";
import { hasPermission } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { getJudge } from "@/lib/server/judge";
import { judgeStatus, queueHealth } from "@/lib/server/services/ops";
import { requeueAnalysisJobAction, requeueJudgeJobAction } from "./actions";

function Counts({ byStatus }: { byStatus: Record<string, number> }) {
  const order = ["pending", "claimed", "done", "dead"];
  return (
    <dl className="flex flex-wrap gap-4 text-sm">
      {order.map((s) => (
        <div key={s} className="flex flex-col">
          <dt className="text-xs uppercase text-zinc-500">{s}</dt>
          <dd className={`text-lg font-semibold ${s === "dead" && byStatus[s] ? "text-red-700 dark:text-red-400" : ""}`}>{byStatus[s] ?? 0}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function OpsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!hasPermission(user.roles, "ops:manage")) return <main className="mx-auto w-full max-w-5xl px-4 py-16 text-sm">No access. Operations are available to admins.</main>;
  const [health, judge] = await Promise.all([queueHealth(getDb(), user), judgeStatus(getJudge())]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Operations</h1>

      <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-semibold">Judge</h2>
        <p className="text-sm">
          Provider <code className="font-mono">{judge.provider}</code>
          {judge.provider === "mock" && " (simulated verdicts, no code is executed)"} ·{" "}
          {judge.reachable === null ? "always available" : judge.reachable ? <span className="text-green-700 dark:text-green-400">reachable</span> : <span className="text-red-700 dark:text-red-400">unreachable or rejecting credentials</span>}
        </p>
        <Counts byStatus={health.judge.byStatus} />
        {health.judge.oldestPending && (
          <p className="text-xs text-zinc-500">
            Oldest pending job created <LocalTime iso={health.judge.oldestPending.toISOString()} />
          </p>
        )}
        {health.judge.dead.length > 0 && (
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 font-medium">Dead since</th>
                <th className="py-1 font-medium">Attempts</th>
                <th className="py-1 font-medium">Last error</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {health.judge.dead.map((j) => (
                <tr key={j.id} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="py-1">
                    <LocalTime iso={j.updatedAt.toISOString()} />
                  </td>
                  <td className="py-1">{j.attempts}</td>
                  <td className="py-1 font-mono">{j.lastError ?? "—"}</td>
                  <td className="py-1 text-right">
                    <form action={requeueJudgeJobAction.bind(null, j.id)}>
                      <SubmitButton variant="secondary" pendingLabel="Requeueing…">
                        Requeue
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-semibold">Integrity analysis</h2>
        <Counts byStatus={health.analysis.byStatus} />
        {health.analysis.dead.map((j) => (
          <div key={j.id} className="flex items-center justify-between gap-3 text-xs">
            <span className="font-mono">{j.lastError ?? "—"}</span>
            <form action={requeueAnalysisJobAction.bind(null, j.id)}>
              <SubmitButton variant="secondary" pendingLabel="Requeueing…">
                Requeue
              </SubmitButton>
            </form>
          </div>
        ))}
      </section>
    </main>
  );
}
