import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { contest, problem } from "./contests";

// ---------------------------------------------------------------- templates

/** A contestant's personal template (named slot). Content lives in versions. */
export const userTemplate = pgTable(
  "user_template",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Archived templates stop applying to contests that start after this instant. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("user_template_user_idx").on(t.userId)],
);

/**
 * Append-only template versions with server timestamps. The templates in
 * effect for a contest are, per template, the latest version created before
 * the contest started: edits made later never apply to that contest.
 */
export const userTemplateVersion = pgTable(
  "user_template_version",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    templateId: uuid("template_id")
      .notNull()
      .references(() => userTemplate.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("user_template_version_template_idx").on(t.templateId, t.createdAt),
    check("user_template_version_hash", sql`${t.sourceSha256} = encode(sha256(convert_to(${t.source}, 'UTF8')), 'hex')`),
    check("user_template_version_size", sql`octet_length(${t.source}) <= 65536`),
  ],
);

/** Contest-wide snippets approved by the contest's managers (e.g. a provided I/O helper). */
export const approvedSnippet = pgTable(
  "approved_snippet",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contest.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    source: text("source").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (t) => [
    index("approved_snippet_contest_idx").on(t.contestId),
    check("approved_snippet_hash", sql`${t.sourceSha256} = encode(sha256(convert_to(${t.source}, 'UTF8')), 'hex')`),
    check("approved_snippet_size", sql`octet_length(${t.source}) <= 65536`),
  ],
);

// ---------------------------------------------------------------- analysis pipeline

export const analysisJobStatus = pgEnum("analysis_job_status", ["pending", "claimed", "done", "dead"]);

/**
 * One durable job per assessment subject (contestant, contest, problem).
 * Re-enqueueing a subject resets it to pending (or flags a re-run if a worker
 * holds it), so bursts of triggers collapse into one computation.
 */
export const analysisJob = pgTable(
  "analysis_job",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contest.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problem.id, { onDelete: "cascade" }),
    status: analysisJobStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    rerunRequested: integer("rerun_requested").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("analysis_job_subject_uq").on(t.userId, t.contestId, t.problemId), index("analysis_job_claim_idx").on(t.status, t.availableAt)],
);

/**
 * Deterministic features for one subject, keyed by the digest of the exact
 * inputs used. Re-running on unchanged inputs reuses the same row.
 */
export const featureVector = pgTable(
  "feature_vector",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contest.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problem.id, { onDelete: "cascade" }),
    featureSetVersion: text("feature_set_version").notNull(),
    inputsDigest: text("inputs_digest").notNull(),
    features: jsonb("features").$type<Record<string, unknown>>().notNull(),
    dataQuality: jsonb("data_quality").$type<Record<string, unknown>>().notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("feature_vector_inputs_uq").on(t.userId, t.contestId, t.problemId, t.featureSetVersion, t.inputsDigest),
    index("feature_vector_cohort_idx").on(t.contestId, t.problemId, t.featureSetVersion, t.computedAt),
  ],
);

export const assessmentBand = pgEnum("assessment_band", ["typical", "elevated", "insufficient_data"]);

/**
 * A scored, explained assessment. Immutable history: re-scoring (e.g. once
 * the cohort is complete) appends a new row. Never a verdict of misconduct.
 */
export const anomalyAssessment = pgTable(
  "anomaly_assessment",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    featureVectorId: uuid("feature_vector_id")
      .notNull()
      .references(() => featureVector.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contest.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problem.id, { onDelete: "cascade" }),
    rulesetVersion: text("ruleset_version").notNull(),
    /** 0–100, null when data was insufficient to score. */
    score: real("score"),
    band: assessmentBand("band").notNull(),
    /** Digest of the cohort statistics used, so identical re-scores are skipped. */
    referenceDigest: text("reference_digest").notNull(),
    reference: jsonb("reference").$type<Record<string, unknown>>().notNull(),
    contributions: jsonb("contributions").$type<unknown[]>().notNull(),
    evidence: jsonb("evidence").$type<unknown[]>().notNull(),
    warnings: jsonb("warnings").$type<unknown[]>().notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("anomaly_assessment_subject_idx").on(t.userId, t.contestId, t.problemId, t.computedAt),
    index("anomaly_assessment_queue_idx").on(t.contestId, t.band, t.score),
    check("anomaly_assessment_score_range", sql`${t.score} IS NULL OR (${t.score} >= 0 AND ${t.score} <= 100)`),
  ],
);
