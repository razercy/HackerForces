import Link from "next/link";
import { SubmissionsTable } from "@/components/submissions-table";
import { requireUser } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { loadOr404 } from "@/lib/server/page-guards";
import { getContestForViewer } from "@/lib/server/services/contests";
import { listOwnSubmissions } from "@/lib/server/services/submissions";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "My submissions" };

export default async function MySubmissionsPage({ params }: PageProps<"/contests/[slug]/submissions">) {
  const { slug } = await params;
  const viewer = await loadOr404(requireUser());
  const c = await loadOr404(getContestForViewer(getDb(), viewer, slug));
  const rows = await listOwnSubmissions(getDb(), viewer, c.slug, { limit: 100 });
  return (
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-8">
      <nav className="text-sm text-zinc-500 dark:text-zinc-400">
        <Link href={`/contests/${c.slug}`} className="hover:underline">
          {c.title}
        </Link>
      </nav>
      <h1 className="text-2xl font-semibold">My submissions</h1>
      <SubmissionsTable rows={rows} contestSlug={c.slug} />
    </main>
  );
}
