import "server-only";
import { and, inArray, isNull, lt } from "drizzle-orm";
import { recordAudit } from "@/lib/server/audit";
import type { Db } from "@/lib/server/db";
import { codeSnapshot, ideSession, telemetryEvent } from "@/lib/server/db/schema";

export const DEFAULT_RETENTION_DAYS = 180;
const BATCH = 200;

/**
 * Deletes raw events and periodic snapshots of sessions older than the
 * retention window. Session rows remain (marked purged) so submissions keep
 * their link and reviewers see why the detail is gone. Submitted code is a
 * contest record and is not affected.
 */
export async function purgeExpiredTelemetry(db: Db, { now = new Date(), retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 3600_000);
  let sessions = 0;
  for (;;) {
    const ids = (
      await db
        .select({ id: ideSession.id })
        .from(ideSession)
        .where(and(lt(ideSession.startedAt, cutoff), isNull(ideSession.purgedAt)))
        .limit(BATCH)
    ).map((r) => r.id);
    if (ids.length === 0) break;
    await db.transaction(async (tx) => {
      await tx.delete(telemetryEvent).where(inArray(telemetryEvent.sessionId, ids));
      await tx.delete(codeSnapshot).where(inArray(codeSnapshot.sessionId, ids));
      await tx.update(ideSession).set({ purgedAt: now }).where(inArray(ideSession.id, ids));
    });
    sessions += ids.length;
    if (ids.length < BATCH) break;
  }
  if (sessions > 0) {
    await recordAudit(db, { actorId: null, action: "telemetry.purge", targetType: "system", targetId: "telemetry", metadata: { sessions, cutoff: cutoff.toISOString() } });
  }
  return { sessions, cutoff };
}
