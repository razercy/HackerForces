import "server-only";
import { and, eq } from "drizzle-orm";
import { effectiveRoles, hasPermission, type ElevatedRole, type Role } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/server/audit";
import type { Db } from "@/lib/server/db";
import { user, userRole } from "@/lib/server/db/schema";
import { AppError, forbidden, notFound } from "@/lib/server/errors";

/** An authenticated caller, with roles already resolved from the database. */
export type Principal = { userId: string; roles: Role[] };

/** Operator scripts (seed, bootstrap) act as SYSTEM; never derived from a request. */
export const SYSTEM = Symbol("system");
export type Actor = Principal | typeof SYSTEM;

function assertCanManageRoles(actor: Actor): string | null {
  if (actor === SYSTEM) return null;
  if (!hasPermission(actor.roles, "role:manage")) throw forbidden();
  return actor.userId;
}

export async function getRoles(db: Db, userId: string): Promise<Role[]> {
  const rows = await db.select({ role: userRole.role }).from(userRole).where(eq(userRole.userId, userId));
  return effectiveRoles(rows.map((r) => r.role));
}

export async function grantRole(db: Db, actor: Actor, targetUserId: string, role: ElevatedRole): Promise<void> {
  const actorId = assertCanManageRoles(actor);
  await db.transaction(async (tx) => {
    const [target] = await tx.select({ id: user.id }).from(user).where(eq(user.id, targetUserId));
    if (!target) throw notFound("User");

    const inserted = await tx
      .insert(userRole)
      .values({ userId: targetUserId, role, grantedBy: actorId })
      .onConflictDoNothing()
      .returning({ role: userRole.role });
    // Idempotent: re-granting an existing role is a no-op and is not audited.
    if (inserted.length === 0) return;

    await recordAudit(tx, { actorId, action: "role.grant", targetType: "user", targetId: targetUserId, metadata: { role } });
  });
}

export async function revokeRole(db: Db, actor: Actor, targetUserId: string, role: ElevatedRole): Promise<void> {
  const actorId = assertCanManageRoles(actor);
  await db.transaction(async (tx) => {
    if (role === "admin") {
      // Lock admin rows so two concurrent revocations cannot both pass the check.
      const admins = await tx.select({ userId: userRole.userId }).from(userRole).where(eq(userRole.role, "admin")).for("update");
      if (admins.length === 1 && admins[0]?.userId === targetUserId) {
        throw new AppError("CONFLICT", "Cannot revoke the last admin", 409);
      }
    }

    const deleted = await tx
      .delete(userRole)
      .where(and(eq(userRole.userId, targetUserId), eq(userRole.role, role)))
      .returning({ role: userRole.role });
    if (deleted.length === 0) return;

    await recordAudit(tx, { actorId, action: "role.revoke", targetType: "user", targetId: targetUserId, metadata: { role } });
  });
}
