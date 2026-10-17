import Link from "next/link";
import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/server/authz";

// UI gate only; every query below re-checks integrity:review on the server.
export default async function ReviewLayout({ children }: LayoutProps<"/review">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!hasPermission(user.roles, "integrity:review")) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-16">
        <h1 className="text-xl font-semibold">No access</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Integrity review requires the reviewer or admin role.</p>
      </main>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
      <nav aria-label="Review" className="flex flex-wrap gap-4 border-b border-zinc-200 pb-3 text-sm dark:border-zinc-800">
        <span className="font-semibold">Integrity review</span>
        <Link href="/review" className="hover:underline">
          Cases
        </Link>
        <Link href="/review/assessments" className="hover:underline">
          All assessments
        </Link>
      </nav>
      <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
        Scores describe how code appeared in the editor. They are prompts for review, not evidence of misconduct. Client telemetry can be incomplete or
        manipulated. Read the data-quality warnings first.
      </p>
      {children}
    </div>
  );
}
