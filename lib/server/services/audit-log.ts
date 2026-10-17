import "server-only";
import { and, desc, eq, like, type SQL } from "drizzle-orm";
import { hasPermission } from "@/lib/auth/roles";
import type { Db } from "@/lib/server/db";
import { auditLog, user } from "@/lib/server/db/schema";
import { forbidden } from "@/lib/server/errors";
import type { Principal } from "./roles";

export type AuditFilters = { actionPrefix?: string; targetType?: string; targetId?: string; page?: number; pageSize?: number };

/** Read-only view of the append-only audit log (admins). */
export async function listAuditLog(db: Db, viewer: Principal, f: AuditFilters = {}) {
  if (!hasPermission(viewer.roles, "audit:read")) throw forbidden();
  const conds: SQL[] = [];
  // Strip LIKE wildcards so the filter is a literal prefix.
  if (f.actionPrefix) conds.push(like(auditLog.action, `${f.actionPrefix.replace(/[%_\\]/g, "")}%`));
  if (f.targetType) conds.push(eq(auditLog.targetType, f.targetType));
  if (f.targetId) conds.push(eq(auditLog.targetId, f.targetId));
  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const page = Math.max(1, f.page ?? 1);
  const rows = await db
    .select({ id: auditLog.id, action: auditLog.action, targetType: auditLog.targetType, targetId: auditLog.targetId, metadata: auditLog.metadata, createdAt: auditLog.createdAt, actorId: auditLog.actorId, actorName: user.name })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return { items: rows.slice(0, pageSize), hasMore: rows.length > pageSize, page };
}
