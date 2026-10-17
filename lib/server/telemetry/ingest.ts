import "server-only";
import { and, count, eq, sql } from "drizzle-orm";
import { contestPhase } from "@/lib/contest-phase";
import type { Db } from "@/lib/server/db";
import { codeSnapshot, contest, contestParticipant, contestProblem, ideSession, telemetryEvent } from "@/lib/server/db/schema";
import { AppError, forbidden, notFound } from "@/lib/server/errors";
import { hasCurrentAcknowledgement } from "@/lib/server/services/acknowledgements";
import type { Principal } from "@/lib/server/services/roles";
import { sha256Hex } from "@/lib/server/services/submissions";
import { isUuid } from "@/lib/validation/ids";
import { TELEMETRY_SCHEMA_VERSION, startSessionSchema, telemetryBatchSchema, type TelemetryEvent } from "@/lib/telemetry/events";
import { TELEMETRY_NOTICE_VERSION } from "@/lib/telemetry/notice";

type Clock = { now?: Date };

/** Late flushes (closing the tab right at the end) are still accepted for a while. */
export const INGEST_GRACE_MS = 15 * 60_000;
export const MAX_EVENTS_PER_SESSION = 50_000;
export const MAX_SESSIONS_PER_USER_CONTEST = 500;

const ackRequired = () => new AppError("FORBIDDEN", "Accept the activity-recording notice for this contest first", 403);

/**
 * Opens an editor session. Requires a registered participant who has accepted
 * the current notice, during the contest.
 */
export async function startSession(db: Db, viewer: Principal, raw: unknown, { now = new Date(), userAgent }: Clock & { userAgent?: string | null } = {}) {
  const input = startSessionSchema.parse(raw);
  const [c] = await db.select().from(contest).where(eq(contest.slug, input.contestSlug));
  if (!c || c.status !== "published") throw notFound("Contest");
  if (contestPhase(c, now) !== "running") throw new AppError("CONFLICT", "The contest is not running", 409);

  const [participant] = await db
    .select({ userId: contestParticipant.userId })
    .from(contestParticipant)
    .where(and(eq(contestParticipant.contestId, c.id), eq(contestParticipant.userId, viewer.userId)));
  if (!participant) throw new AppError("FORBIDDEN", "Register for the contest first", 403);
  if (!(await hasCurrentAcknowledgement(db, viewer.userId, c.id))) throw ackRequired();

  const [p] = await db
    .select({ problemId: contestProblem.problemId })
    .from(contestProblem)
    .where(and(eq(contestProblem.contestId, c.id), eq(contestProblem.label, input.label)));
  if (!p) throw notFound("Problem");

  const [{ n }] = (await db
    .select({ n: count() })
    .from(ideSession)
    .where(and(eq(ideSession.userId, viewer.userId), eq(ideSession.contestId, c.id)))) as [{ n: number }];
  if (n >= MAX_SESSIONS_PER_USER_CONTEST) throw new AppError("RATE_LIMITED", "Too many editor sessions", 429);

  const [row] = await db
    .insert(ideSession)
    .values({
      userId: viewer.userId,
      contestId: c.id,
      problemId: p.problemId,
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      noticeVersion: TELEMETRY_NOTICE_VERSION,
      userAgent: userAgent?.slice(0, 300) ?? null,
      startedAt: now,
      clientStartedAt: new Date(input.clientStartedAt),
    })
    .returning({ id: ideSession.id });
  return { sessionId: row!.id };
}

function payloadOf(e: TelemetryEvent): Record<string, unknown> {
  const { seq: _seq, t: _t, type: _type, ...rest } = e;
  if (e.type === "snapshot") {
    // The source goes to code_snapshot; the event keeps only a reference.
    return { reason: e.reason, sha256: sha256Hex(e.source), bytes: Buffer.byteLength(e.source, "utf8") };
  }
  return rest;
}

export type IngestResult = { accepted: number; duplicates: number; maxSeq: number };

/**
 * Idempotent batch ingestion. (session_id, seq) is the key, so retried or
 * duplicated batches are absorbed; events may arrive in any order. The
 * session row is locked so arrival numbering and counters stay consistent.
 */
export async function ingestBatch(db: Db, viewer: Principal, raw: unknown, { now = new Date() }: Clock = {}): Promise<IngestResult> {
  const batch = telemetryBatchSchema.parse(raw);
  if (!isUuid(batch.sessionId)) throw notFound("Session");

  return db.transaction(async (tx) => {
    const [s] = await tx
      .select({ id: ideSession.id, userId: ideSession.userId, receivedCount: ideSession.receivedCount, endsAt: contest.endsAt })
      .from(ideSession)
      .innerJoin(contest, eq(contest.id, ideSession.contestId))
      .where(eq(ideSession.id, batch.sessionId))
      .for("update", { of: ideSession });
    // Someone else's session is indistinguishable from a missing one.
    if (!s || s.userId !== viewer.userId) throw notFound("Session");
    if (now.getTime() > s.endsAt.getTime() + INGEST_GRACE_MS) throw forbidden();
    if (s.receivedCount + batch.events.length > MAX_EVENTS_PER_SESSION) throw new AppError("RATE_LIMITED", "Telemetry quota exceeded for this session", 429);

    const inserted = await tx
      .insert(telemetryEvent)
      .values(
        batch.events.map((e, i) => ({
          sessionId: s.id,
          seq: e.seq,
          type: e.type,
          clientTs: new Date(e.t),
          receivedAt: now,
          arrival: s.receivedCount + i,
          payload: payloadOf(e),
        })),
      )
      .onConflictDoNothing()
      .returning({ seq: telemetryEvent.seq });

    const fresh = new Set(inserted.map((r) => r.seq));
    const snapshots = batch.events.filter((e): e is Extract<TelemetryEvent, { type: "snapshot" }> => e.type === "snapshot" && fresh.has(e.seq));
    if (snapshots.length > 0) {
      await tx
        .insert(codeSnapshot)
        .values(snapshots.map((e) => ({ sessionId: s.id, seq: e.seq, source: e.source, sourceSha256: sha256Hex(e.source), createdAt: now })))
        .onConflictDoNothing();
    }

    const batchMax = Math.max(...batch.events.map((e) => e.seq));
    const duplicates = batch.events.length - inserted.length;
    const [updated] = await tx
      .update(ideSession)
      .set({
        maxSeq: sql`greatest(${ideSession.maxSeq}, ${batchMax})`,
        receivedCount: sql`${ideSession.receivedCount} + ${inserted.length}`,
        duplicateCount: sql`${ideSession.duplicateCount} + ${duplicates}`,
        lastReceivedAt: now,
      })
      .where(eq(ideSession.id, s.id))
      .returning({ maxSeq: ideSession.maxSeq });
    return { accepted: inserted.length, duplicates, maxSeq: updated!.maxSeq };
  });
}
