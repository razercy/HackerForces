import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/server/db";
import { codeSnapshot, ideSession, submission, telemetryAcknowledgement, telemetryEvent } from "@/lib/server/db/schema";
import { acknowledgeNotice, getContestForViewer, registerForContest } from "@/lib/server/services/contests";
import type { Principal } from "@/lib/server/services/roles";
import { createSubmission, sha256Hex } from "@/lib/server/services/submissions";
import { INGEST_GRACE_MS, ingestBatch, startSession } from "@/lib/server/telemetry/ingest";
import { purgeExpiredTelemetry } from "@/lib/server/telemetry/retention";
import { getSessionTimeline } from "@/lib/server/telemetry/timeline";
import { TELEMETRY_SCHEMA_VERSION } from "@/lib/telemetry/events";
import { TELEMETRY_NOTICE_VERSION } from "@/lib/telemetry/notice";
import { ACK, AC_SOURCE, at, runningContest } from "../helpers/contest-fixture";
import { createTestDb } from "../helpers/db";
import { principal } from "../helpers/fixtures";

let db: Db;
let close: () => Promise<void>;
let setter: Principal, reviewer: Principal, admin: Principal, alice: Principal, bob: Principal, late: Principal, outsider: Principal;
let contestId: string, slug: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  [setter, reviewer, admin, alice, bob, late, outsider] = await Promise.all([
    principal(db, "problem_setter"),
    principal(db, "reviewer"),
    principal(db, "admin"),
    principal(db),
    principal(db),
    principal(db),
    principal(db),
  ]);
  ({ id: contestId, slug } = await runningContest(db, setter, [alice, bob]));
});
afterAll(async () => close());

const t0 = at(1.5);
const start = (who: Principal, label = "A", now = t0) => startSession(db, who, { contestSlug: slug, label, clientStartedAt: now.getTime() }, { now, userAgent: "vitest" });
const edit = (seq: number, origin = "input.type", inserted = 1, offsetMs = seq * 500) => ({
  seq,
  t: t0.getTime() + offsetMs,
  type: "edit" as const,
  origin,
  changes: 1,
  from: 0,
  inserted,
  deleted: 0,
  insertedLines: 0,
  docLength: 10 + seq,
});
const send = (who: Principal, sessionId: string, events: unknown[], now = t0) => ingestBatch(db, who, { sessionId, schemaVersion: TELEMETRY_SCHEMA_VERSION, events }, { now });

describe("activity-recording notice", () => {
  it("blocks registration without accepting the current version, and stores who accepted what and when", async () => {
    await expect(registerForContest(db, late, contestId, { noticeVersion: undefined }, { now: at(1.2) })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(registerForContest(db, late, contestId, { noticeVersion: "2020-01-01.v0" }, { now: at(1.2) })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await getContestForViewer(db, late, slug, { now: at(1.2) })).isRegistered).toBe(false);

    await registerForContest(db, late, contestId, ACK, { now: at(1.2) });
    const acks = await db.select().from(telemetryAcknowledgement).where(eq(telemetryAcknowledgement.userId, late.userId));
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({ contestId, noticeVersion: TELEMETRY_NOTICE_VERSION, acceptedAt: at(1.2) });
  });

  it("acknowledgements are append-only", async () => {
    const [row] = await db.select().from(telemetryAcknowledgement).limit(1);
    await expect(db.update(telemetryAcknowledgement).set({ noticeVersion: "forged" }).where(eq(telemetryAcknowledgement.id, row!.id))).rejects.toThrow();
  });

  it("a participant without a current acknowledgement can neither start the editor nor submit until they accept", async () => {
    // Simulate a registration from before the notice existed (or under an older version).
    await db.delete(telemetryAcknowledgement).where(eq(telemetryAcknowledgement.userId, bob.userId));
    expect(await getContestForViewer(db, bob, slug, { now: t0 })).toMatchObject({ isRegistered: true, needsAcknowledgement: true });
    await expect(start(bob)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createSubmission(db, bob, slug, { label: "A", language: "cpp17", source: AC_SOURCE }, { now: t0 })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await acknowledgeNotice(db, bob, contestId, ACK, { now: t0 });
    expect((await getContestForViewer(db, bob, slug, { now: t0 })).needsAcknowledgement).toBe(false);
    await expect(start(bob)).resolves.toHaveProperty("sessionId");
    await expect(acknowledgeNotice(db, outsider, contestId, ACK)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("editor sessions", () => {
  it("only registered participants can start a session, and only while the contest runs", async () => {
    await expect(start(outsider)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(start(alice, "A", at(0.5))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(start(alice, "A", at(3.1))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(start(alice, "Z")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { sessionId } = await start(alice);
    const [s] = await db.select().from(ideSession).where(eq(ideSession.id, sessionId));
    expect(s).toMatchObject({ userId: alice.userId, schemaVersion: TELEMETRY_SCHEMA_VERSION, noticeVersion: TELEMETRY_NOTICE_VERSION, maxSeq: -1, userAgent: "vitest" });
  });
});

describe("ingestion", () => {
  it("is idempotent: retried and overlapping batches never duplicate events", async () => {
    const { sessionId } = await start(alice);
    expect(await send(alice, sessionId, [edit(0), edit(1), edit(2)])).toEqual({ accepted: 3, duplicates: 0, maxSeq: 2 });
    expect(await send(alice, sessionId, [edit(0), edit(1), edit(2)])).toEqual({ accepted: 0, duplicates: 3, maxSeq: 2 });
    expect(await send(alice, sessionId, [edit(2), edit(3)])).toEqual({ accepted: 1, duplicates: 1, maxSeq: 3 });
    expect(await db.select().from(telemetryEvent).where(eq(telemetryEvent.sessionId, sessionId))).toHaveLength(4);
    const [s] = await db.select().from(ideSession).where(eq(ideSession.id, sessionId));
    expect(s).toMatchObject({ receivedCount: 4, duplicateCount: 4, maxSeq: 3 });
  });

  it("accepts out-of-order batches and records arrival order", async () => {
    const { sessionId } = await start(alice);
    await send(alice, sessionId, [edit(3), edit(4)]);
    await send(alice, sessionId, [edit(0), edit(1), edit(2)]);
    const rows = await db.select().from(telemetryEvent).where(eq(telemetryEvent.sessionId, sessionId));
    const arrivalBySeq = Object.fromEntries(rows.map((r) => [r.seq, r.arrival]));
    expect(arrivalBySeq).toEqual({ 3: 0, 4: 1, 0: 2, 1: 3, 2: 4 });
  });

  it("stores snapshots separately with a server-computed hash; the event keeps only a reference", async () => {
    const { sessionId } = await start(alice);
    const source = "int main() { return 0; }\n";
    await send(alice, sessionId, [{ seq: 0, t: t0.getTime(), type: "snapshot", source, reason: "initial" }]);
    const [snap] = await db.select().from(codeSnapshot).where(eq(codeSnapshot.sessionId, sessionId));
    expect(snap).toMatchObject({ seq: 0, source, sourceSha256: sha256Hex(source) });
    const [event] = await db.select().from(telemetryEvent).where(eq(telemetryEvent.sessionId, sessionId));
    expect(event!.payload).toEqual({ reason: "initial", sha256: sha256Hex(source), bytes: source.length });
  });

  it("rejects another user's session as not found, and malformed batches", async () => {
    const { sessionId } = await start(alice);
    await expect(send(bob, sessionId, [edit(0)])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(send(alice, sessionId, [{ ...edit(0), clipboard: "secret" }])).rejects.toBeInstanceOf(ZodError);
    await expect(ingestBatch(db, alice, { sessionId, schemaVersion: 2, events: [edit(0)] }, { now: t0 })).rejects.toBeInstanceOf(ZodError);
    expect(await db.select().from(telemetryEvent).where(eq(telemetryEvent.sessionId, sessionId))).toHaveLength(0);
  });

  it("accepts late flushes within the grace period after the contest ends, then refuses", async () => {
    const { sessionId } = await start(alice);
    await expect(send(alice, sessionId, [edit(0)], new Date(at(3).getTime() + INGEST_GRACE_MS - 1))).resolves.toMatchObject({ accepted: 1 });
    await expect(send(alice, sessionId, [edit(1)], new Date(at(3).getTime() + INGEST_GRACE_MS + 1))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("submissions linked to editor sessions", () => {
  it("records the session and seq; a session for another problem or user is rejected", async () => {
    const { sessionId } = await start(alice, "A");
    const { id } = await createSubmission(db, alice, slug, { label: "A", language: "cpp17", source: AC_SOURCE, ideSessionId: sessionId, ideSeq: 7 }, { now: at(2) });
    const [row] = await db.select().from(submission).where(eq(submission.id, id));
    expect(row).toMatchObject({ ideSessionId: sessionId, ideSeq: 7 });

    await expect(
      createSubmission(db, alice, slug, { label: "B", language: "cpp17", source: AC_SOURCE, ideSessionId: sessionId }, { now: at(2.1) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      createSubmission(db, bob, slug, { label: "A", language: "cpp17", source: AC_SOURCE, ideSessionId: sessionId }, { now: at(2.1) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // The link is part of the immutable record.
    await expect(db.update(submission).set({ ideSeq: 8 }).where(eq(submission.id, id))).rejects.toThrow();
  });
});

describe("timeline", () => {
  it("is visible to reviewers and admins only", async () => {
    const { sessionId } = await start(alice);
    await expect(getSessionTimeline(db, reviewer, sessionId)).resolves.toHaveProperty("session");
    await expect(getSessionTimeline(db, admin, sessionId)).resolves.toHaveProperty("session");
    await expect(getSessionTimeline(db, alice, sessionId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getSessionTimeline(db, setter, sessionId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reconstructs the session with summaries and data-quality warnings", async () => {
    const { sessionId } = await start(alice);
    const code = "int main(){}\n";
    await send(alice, sessionId, [
      { seq: 0, t: t0.getTime(), type: "session_start", docLength: 0, restoredDraft: false },
      edit(1, "input.type", 1),
      edit(2, "input.paste", 120),
      // seq 3 never arrives
      edit(4, "undo", 0),
      { seq: 5, t: t0.getTime() + 3_000, type: "snapshot", source: code, reason: "submit" },
      { seq: 6, t: t0.getTime() + 3_100, type: "submit" },
    ]);
    await createSubmission(db, alice, slug, { label: "A", language: "cpp17", source: "int main(){ /* different */ }\n", ideSessionId: sessionId, ideSeq: 6 }, { now: at(2.2) });

    const tl = await getSessionTimeline(db, reviewer, sessionId);
    expect(tl.events.map((e) => e.seq)).toEqual([0, 1, 2, 4, 5, 6]);
    expect(tl.summary).toMatchObject({ edits: 3, typedChars: 1, pastedChars: 120, pasteCount: 1, undoCount: 1, submits: 1, snapshots: 1 });
    expect(tl.snapshots[0]).toMatchObject({ seq: 5, source: code, reason: "submit" });
    expect(tl.submissions).toHaveLength(1);
    expect(tl.session).toMatchObject({ label: "A", userName: expect.any(String) });
    const codes = tl.warnings.map((w) => w.code);
    expect(codes).toContain("missing_events");
    expect(codes).toContain("submission_snapshot_mismatch");
  });
});

describe("retention", () => {
  it("purges raw events and snapshots of old sessions but keeps sessions and submissions", async () => {
    const { sessionId } = await start(alice);
    await send(alice, sessionId, [edit(0), { seq: 1, t: t0.getTime(), type: "snapshot", source: "x", reason: "interval" }]);
    const { id: subId } = await createSubmission(db, alice, slug, { label: "A", language: "cpp17", source: AC_SOURCE, ideSessionId: sessionId, ideSeq: 2 }, { now: at(2.4) });

    // Not yet expired.
    expect((await purgeExpiredTelemetry(db, { now: at(24), retentionDays: 180 })).sessions).toBe(0);

    const later = new Date(t0.getTime() + 181 * 24 * 3600_000);
    const { sessions } = await purgeExpiredTelemetry(db, { now: later, retentionDays: 180 });
    expect(sessions).toBeGreaterThan(0);
    expect(await db.select().from(telemetryEvent).where(eq(telemetryEvent.sessionId, sessionId))).toHaveLength(0);
    expect(await db.select().from(codeSnapshot).where(eq(codeSnapshot.sessionId, sessionId))).toHaveLength(0);
    const [s] = await db.select().from(ideSession).where(eq(ideSession.id, sessionId));
    expect(s!.purgedAt).toEqual(later);
    expect(await db.select().from(submission).where(eq(submission.id, subId))).toHaveLength(1);
    expect((await getSessionTimeline(db, reviewer, sessionId)).warnings.map((w) => w.code)).toEqual(["purged"]);
    // Idempotent.
    expect((await purgeExpiredTelemetry(db, { now: later, retentionDays: 180 })).sessions).toBe(0);
  });
});
