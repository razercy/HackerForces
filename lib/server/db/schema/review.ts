import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { REVIEW_OUTCOMES } from "@/lib/review";
import { user } from "./auth";
import { contest, problem } from "./contests";
import { anomalyAssessment } from "./integrity";

export const reviewCaseStatus = pgEnum("review_case_status", ["open", "awaiting_confirmation", "closed"]);
export const reviewOutcome = pgEnum("review_outcome", REVIEW_OUTCOMES);
export const confirmationVerdict = pgEnum("confirmation_verdict", ["confirmed", "rejected"]);

/**
 * A human review of one subject (contestant × contest × problem). At most one
 * case per subject is not closed; closed cases can be reopened.
 */
export const reviewCase = pgTable(
  "review_case",
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
    status: reviewCaseStatus("status").notNull().default("open"),
    /** "elevated_assessment" (opened by the system) or "manual". */
    openedReason: text("opened_reason").notNull(),
    /** Null when opened by the system. */
    openedBy: text("opened_by").references(() => user.id, { onDelete: "set null" }),
    /** Assessment that triggered the case (the case page always shows the latest one too). */
    assessmentId: uuid("assessment_id").references(() => anomalyAssessment.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("review_case_one_active_uq").on(t.userId, t.contestId, t.problemId).where(sql`${t.status} <> 'closed'`),
    index("review_case_queue_idx").on(t.status, t.updatedAt),
    index("review_case_subject_idx").on(t.userId, t.contestId, t.problemId),
  ],
);

/**
 * Append-only reviewer decisions. A change of mind is a new decision that
 * supersedes the old one, never an edit.
 */
export const reviewDecision = pgTable(
  "review_decision",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    caseId: uuid("case_id")
      .notNull()
      .references(() => reviewCase.id, { onDelete: "restrict" }),
    reviewerId: text("reviewer_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    outcome: reviewOutcome("outcome").notNull(),
    rationale: text("rationale").notNull(),
    /** The assessment version the reviewer was looking at. */
    assessmentId: uuid("assessment_id").references(() => anomalyAssessment.id, { onDelete: "set null" }),
    supersedesId: uuid("supersedes_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("review_decision_case_idx").on(t.caseId, t.createdAt),
    check("review_decision_rationale_len", sql`char_length(${t.rationale}) BETWEEN 30 AND 10000`),
  ],
);

/**
 * Second-person confirmation of a "confirmed_violation" decision. Only a
 * confirmed confirmation lets the decision take effect. The confirming admin
 * must differ from the deciding reviewer (enforced by trigger).
 */
export const decisionConfirmation = pgTable(
  "decision_confirmation",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    decisionId: uuid("decision_id")
      .notNull()
      .unique()
      .references(() => reviewDecision.id, { onDelete: "restrict" }),
    adminId: text("admin_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    verdict: confirmationVerdict("verdict").notNull(),
    rationale: text("rationale").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("decision_confirmation_rationale_len", sql`char_length(${t.rationale}) BETWEEN 10 AND 10000`)],
);

export const reviewNote = pgTable(
  "review_note",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    caseId: uuid("case_id")
      .notNull()
      .references(() => reviewCase.id, { onDelete: "restrict" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("review_note_case_idx").on(t.caseId, t.createdAt), check("review_note_len", sql`char_length(${t.body}) BETWEEN 1 AND 5000`)],
);

/** The contestant's written responses to a decision that took effect. */
export const contestantResponse = pgTable(
  "contestant_response",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    caseId: uuid("case_id")
      .notNull()
      .references(() => reviewCase.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contestant_response_case_idx").on(t.caseId, t.createdAt), check("contestant_response_len", sql`char_length(${t.body}) BETWEEN 1 AND 5000`)],
);
