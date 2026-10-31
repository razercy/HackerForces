import Link from "next/link";
import { hasPermission } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/server/authz";
import { NavLink } from "./nav-link";
import { SignOutButton } from "./sign-out-button";

export async function SiteHeader() {
  const user = await getCurrentUser();
  const canManage = !!user && (hasPermission(user.roles, "problem:manage") || hasPermission(user.roles, "contest:manage"));
  const canReview = !!user && hasPermission(user.roles, "integrity:review");
  const canAudit = !!user && hasPermission(user.roles, "audit:read");
  const canOps = !!user && hasPermission(user.roles, "ops:manage");
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <Link href="/" className="font-semibold">
            HackerForces
          </Link>
          <NavLink href="/contests">Contests</NavLink>
          {user && (
            <NavLink href="/templates">Templates</NavLink>
          )}
          {canManage && (
            <NavLink href="/manage">Manage</NavLink>
          )}
          {canReview && (
            <NavLink href="/review">Review</NavLink>
          )}
          {canAudit && (
            <NavLink href="/admin/audit">Audit</NavLink>
          )}
          {canOps && (
            <NavLink href="/admin/ops">Ops</NavLink>
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
