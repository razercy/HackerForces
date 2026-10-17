import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db, Tx } from "@/lib/server/db";
import { telemetryAcknowledgement } from "@/lib/server/db/schema";
import { invalidInput } from "@/lib/server/errors";
import { TELEMETRY_NOTICE_VERSION } from "@/lib/telemetry/notice";

export function assertCurrentNoticeVersion(version: unknown): void {
  if (version !== TELEMETRY_NOTICE_VERSION) {
    throw invalidInput("Please read and accept the current activity-recording notice");
  }
}

export async function hasCurrentAcknowledgement(db: Db | Tx, userId: string, contestId: string): Promise<boolean> {
  const rows = await db
    .select({ id: telemetryAcknowledgement.id })
    .from(telemetryAcknowledgement)
    .where(
      and(
        eq(telemetryAcknowledgement.userId, userId),
        eq(telemetryAcknowledgement.contestId, contestId),
        eq(telemetryAcknowledgement.noticeVersion, TELEMETRY_NOTICE_VERSION),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Records acceptance of the current notice. Idempotent per (user, contest, version). */
export async function recordAcknowledgement(db: Db | Tx, userId: string, contestId: string, now: Date): Promise<void> {
  if (await hasCurrentAcknowledgement(db, userId, contestId)) return;
  await db.insert(telemetryAcknowledgement).values({ userId, contestId, noticeVersion: TELEMETRY_NOTICE_VERSION, acceptedAt: now });
}
