import Link from "next/link";
import { hasPermission } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/server/authz";
import { SignOutButton } from "./sign-out-button";

export async function SiteHeader() {
  const user = await getCurrentUser();
  const canManage = !!user && (hasPermission(user.roles, "problem:manage") || hasPermission(user.roles, "contest:manage"));
  const canReview = !!user && hasPermission(user.roles, "integrity:review");
  const canAudit = !!user && hasPermission(user.roles, "audit:read");
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <Link href="/" className="font-semibold">
            HackerForces
          </Link>
          <Link href="/contests" className="hover:underline">
            Contests
          </Link>
          {user && (
            <Link href="/templates" className="hover:underline">
              Templates
            </Link>
          )}
          {canManage && (
            <Link href="/manage" className="hover:underline">
              Manage
            </Link>
          )}
          {canReview && (
            <Link href="/review" className="hover:underline">
              Review
            </Link>
          )}
          {canAudit && (
            <Link href="/admin/audit" className="hover:underline">
              Audit
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          {user ? (
            <>
              <span className="text-zinc-600 dark:text-zinc-400">{user.name}</span>
              <SignOutButton />
            </>
          ) : (
            <Link href="/sign-in" className="hover:underline">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
