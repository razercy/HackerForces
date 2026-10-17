import Link from "next/link";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { loadOr404 } from "@/lib/server/page-guards";
import { listManageableProblems } from "@/lib/server/services/problems";

export default async function ProblemsPage() {
  const problems = await loadOr404(requireUser().then((u) => listManageableProblems(getDb(), u)));
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Problems</h1>
        <Link href="/manage/problems/new" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          New problem
        </Link>
      </div>
      {problems.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">No problems yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="py-2 font-medium">Title</th>
              <th className="py-2 font-medium">Slug</th>
              <th className="py-2 font-medium">Difficulty</th>
              <th className="py-2 font-medium">Hidden tests</th>
            </tr>
          </thead>
          <tbody>
            {problems.map((p) => (
              <tr key={p.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2">
                  <Link href={`/manage/problems/${p.id}`} className="font-medium hover:underline">
                    {p.title}
                  </Link>
                </td>
                <td className="py-2 font-mono text-xs">{p.slug}</td>
                <td className="py-2">{p.difficulty ?? "—"}</td>
                <td className="py-2">{p.testCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
