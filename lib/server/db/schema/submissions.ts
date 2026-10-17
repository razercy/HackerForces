import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { MAX_SOURCE_BYTES, SUBMISSION_KINDS, SUBMISSION_STATUSES, VERDICTS } from "@/lib/submissions";
import { user } from "./auth";
import { contest, language, problem } from "./contests";
import { ideSession } from "./telemetry";

export const submissionKind = pgEnum("submission_kind", SUBMISSION_KINDS);
export const submissionStatus = pgEnum("submission_status", SUBMISSION_STATUSES);
export const verdict = pgEnum("verdict", VERDICTS);
export const judgeJobStatus = pgEnum("judge_job_status", ["pending", "claimed", "done", "dead"]);

/**
 * One row per submitted program. The submitted columns (source, hash,
 * language, kind, owner, problem, time) are immutable: a trigger rejects any
 * UPDATE that touches them, and a CHECK ties the hash to the stored source.
 * Only the judging-result columns change after insert.
 */
export const submission = pgTable(
  "submission",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contest.id, { onDelete: "restrict" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problem.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    kind: submissionKind("kind").notNull(),
    language: language("language").notNull(),
    source: text("source").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Editor session the submission came from (null = submitted outside the instrumented editor). */
    ideSessionId: uuid("ide_session_id").references(() => ideSession.id, { onDelete: "restrict" }),
    /** Client sequence number of the `submit` event in that session. */
    ideSeq: integer("ide_seq"),

    // ---- judging results (mutable)
    status: submissionStatus("status").notNull().default("queued"),
    verdict: verdict("verdict"),
    timeMs: integer("time_ms"),
    memoryKb: integer("memory_kb"),
    passedTests: integer("passed_tests"),
    totalTests: integer("total_tests"),
    /** Ordinal of the first failing test. Only the ordinal is ever shown, never its data. */
    failedTest: integer("failed_test"),
    compileOutput: text("compile_output"),
    judgeProvider: text("judge_provider"),
    judgedAt: timestamp("judged_at", { withTimezone: true }),
  },
  (t) => [
    index("submission_user_contest_idx").on(t.userId, t.contestId, t.createdAt),
    index("submission_contest_problem_idx").on(t.contestId, t.problemId, t.createdAt),
    check("submission_source_size", sql`octet_length(${t.source}) <= ${sql.raw(String(MAX_SOURCE_BYTES))}`),
    check("submission_source_hash", sql`${t.sourceSha256} = encode(sha256(convert_to(${t.source}, 'UTF8')), 'hex')`),
    check("submission_compile_output_size", sql`${t.compileOutput} IS NULL OR octet_length(${t.compileOutput}) <= 16384`),
  ],
);

/**
 * Durable judging queue. Workers claim a job with FOR UPDATE SKIP LOCKED and
 * hold a time-limited lease; an expired lease makes the job claimable again.
 * `attempts` doubles as a fencing token so a stale worker cannot overwrite a
 * newer attempt's result.
 */
export const judgeJob = pgTable(
  "judge_job",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    submissionId: uuid("submission_id")
      .notNull()
      .unique()
      .references(() => submission.id, { onDelete: "cascade" }),
    status: judgeJobStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("judge_job_claim_idx").on(t.status, t.availableAt)],
);
