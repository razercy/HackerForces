import Link from "next/link";
import { redirect } from "next/navigation";
import { LocalTime } from "@/components/time";
import { inputClass } from "@/components/ui/form";
import { hasPermission } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { listAuditLog } from "@/lib/server/services/audit-log";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!hasPermission(user.roles, "audit:read")) {
    return <main className="mx-auto w-full max-w-5xl px-4 py-16 text-sm">No access. The audit log is available to admins.</main>;
  }
  const sp = await searchParams;
  const f = { actionPrefix: one(sp.action), targetType: one(sp.targetType), targetId: one(sp.targetId), page: Number(one(sp.page) ?? 1) || 1 };
  const { items, hasMore, page } = await listAuditLog(getDb(), user, f);
  const qs = (p: number) =>
    new URLSearchParams({ ...(f.actionPrefix ? { action: f.actionPrefix } : {}), ...(f.targetType ? { targetType: f.targetType } : {}), ...(f.targetId ? { targetId: f.targetId } : {}), page: String(p) });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Append-only: the database rejects edits and deletions of these entries.</p>
      <form method="get" className="flex flex-wrap gap-2 text-sm">
        <input name="action" placeholder="Action prefix (e.g. review.)" defaultValue={f.actionPrefix} className={`${inputClass} sm:w-56`} aria-label="Action prefix" />
        <input name="targetType" placeholder="Target type" defaultValue={f.targetType} className={`${inputClass} sm:w-40`} aria-label="Target type" />
        <input name="targetId" placeholder="Target id" defaultValue={f.targetId} className={`${inputClass} sm:w-80`} aria-label="Target id" />
        <button type="submit" className="rounded-md bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700">
          Filter
        </button>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="py-2 pr-3 font-medium">When</th>
              <th className="py-2 pr-3 font-medium">Actor</th>
              <th className="py-2 pr-3 font-medium">Action</th>
              <th className="py-2 pr-3 font-medium">Target</th>
              <th className="py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  <LocalTime iso={e.createdAt.toISOString()} />
                </td>
                <td className="py-1.5 pr-3">{e.actorName ?? (e.actorId ? "deleted user" : "system")}</td>
                <td className="py-1.5 pr-3 font-mono">{e.action}</td>
                <td className="py-1.5 pr-3 font-mono">
                  {e.targetType === "review_case" ? (
                    <Link href={`/review/cases/${e.targetId}`} className="underline">
                      {e.targetType}:{e.targetId.slice(0, 8)}
                    </Link>
                  ) : (
                    `${e.targetType}:${e.targetId.slice(0, 8)}`
                  )}
                </td>
                <td className="py-1.5 font-mono text-zinc-500">{Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className="flex gap-3 text-sm">
        {page > 1 && (
          <Link href={`/admin/audit?${qs(page - 1)}`} className="underline">
            Newer
          </Link>
        )}
        {hasMore && (
          <Link href={`/admin/audit?${qs(page + 1)}`} className="underline">
            Older
          </Link>
        )}
      </nav>
    </main>
  );
}
