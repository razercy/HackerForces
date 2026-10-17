import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { hasPermission, type Permission } from "@/lib/auth/roles";
import { getAuth } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { forbidden, unauthenticated } from "@/lib/server/errors";
import { getRoles, type Principal } from "@/lib/server/services/roles";

export type CurrentUser = Principal & { name: string; email: string };

/**
 * Data-access-layer entry point: resolves the session and the user's roles
 * from the database on every request (deduplicated per render via `cache`).
 * Roles are never read from the cookie or the client.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // Read request headers first: this marks the caller as dynamic, so session
  // pages are never prerendered at build time.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const roles = await getRoles(getDb(), session.user.id);
  return { userId: session.user.id, name: session.user.name, email: session.user.email, roles };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthenticated();
  return user;
}

export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!hasPermission(user.roles, permission)) throw forbidden();
  return user;
}
