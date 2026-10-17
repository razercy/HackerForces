import Link from "next/link";
import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/server/authz";

// UI gate only. Every page and action below re-checks via the services.
export default async function ManageLayout({ children }: LayoutProps<"/manage">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!hasPermission(user.roles, "problem:manage") && !hasPermission(user.roles, "contest:manage")) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-16">
        <h1 className="text-xl font-semibold">No access</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Contest management requires the problem setter or admin role.</p>
      </main>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <nav aria-label="Management" className="flex gap-4 border-b border-zinc-200 pb-3 text-sm dark:border-zinc-800">
        <span className="font-semibold">Manage</span>
        <Link href="/manage/problems" className="hover:underline">
          Problems
        </Link>
        <Link href="/manage/contests" className="hover:underline">
          Contests
        </Link>
      </nav>
      {children}
    </div>
  );
}
