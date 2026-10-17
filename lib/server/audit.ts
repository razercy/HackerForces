import "server-only";
import type { Db, Tx } from "@/lib/server/db";
import { auditLog } from "@/lib/server/db/schema";

export type AuditEntry = {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
};

/** Call inside the same transaction as the change being audited. */
export async function recordAudit(db: Db | Tx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({ ...entry, metadata: entry.metadata ?? {} });
}
