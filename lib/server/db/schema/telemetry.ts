import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { TELEMETRY_EVENT_TYPES } from "@/lib/telemetry/events";
import { user } from "./auth";
import { contest, problem } from "./contests";

/**
 * Append-only record of which notice version a user accepted for which
 * contest, and when. A new row per acceptance; rows are never updated.
 */
export const telemetryAcknowledgement = pgTable(
  "telemetry_acknowledgement",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contest.id, { onDelete: "cascade" }),
    noticeVersion: text("notice_version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("telemetry_ack_user_contest_idx").on(t.userId, t.contestId, t.noticeVersion)],
);

export const telemetryEventType = pgEnum("telemetry_event_type", TELEMETRY_EVENT_TYPES);

/** One editor session: a single mount of the contest editor for one problem. */
export const ideSession = pgTable(
  "ide_session",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contest.id, { onDelete: "restrict" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problem.id, { onDelete: "restrict" }),
    schemaVersion: integer("schema_version").notNull(),
    noticeVersion: text("notice_version").notNull(),
    userAgent: text("user_agent"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    clientStartedAt: timestamp("client_started_at", { withTimezone: true }),
    /** Highest sequence number received so far (-1 = none). */
    maxSeq: integer("max_seq").notNull().default(-1),
    receivedCount: integer("received_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
    /** Set when retention removed this session's raw events and snapshots. */
    purgedAt: timestamp("purged_at", { withTimezone: true }),
  },
  (t) => [index("ide_session_user_contest_idx").on(t.userId, t.contestId, t.startedAt), index("ide_session_started_idx").on(t.startedAt)],
);

/**
 * Raw client events. (session_id, seq) is the idempotency key: retries and
 * duplicate deliveries are absorbed with ON CONFLICT DO NOTHING.
 */
export const telemetryEvent = pgTable(
  "telemetry_event",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => ideSession.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: telemetryEventType("type").notNull(),
    clientTs: timestamp("client_ts", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    /** Order in which the server stored events for this session; reveals out-of-order delivery. */
    arrival: integer("arrival").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.seq] }), index("telemetry_event_received_idx").on(t.receivedAt)],
);

/** Periodic full-document copies, referenced by a `snapshot` event with the same seq. */
export const codeSnapshot = pgTable(
  "code_snapshot",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => ideSession.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    source: text("source").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.seq] }),
    check("code_snapshot_hash", sql`${t.sourceSha256} = encode(sha256(convert_to(${t.source}, 'UTF8')), 'hex')`),
    check("code_snapshot_size", sql`octet_length(${t.source}) <= 65536`),
  ],
);
