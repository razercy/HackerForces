import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { LANGUAGES } from "@/lib/languages";
import { MAX_TEST_FIELD_BYTES } from "@/lib/validation/problems";
import { user } from "./auth";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const language = pgEnum("language", LANGUAGES);
export const contestStatus = pgEnum("contest_status", ["draft", "published"]);

export const problem = pgTable(
  "problem",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    statement: text("statement").notNull(),
    inputFormat: text("input_format").notNull(),
    outputFormat: text("output_format").notNull(),
    constraints: text("constraints").notNull().default(""),
    notes: text("notes"),
    timeLimitMs: integer("time_limit_ms").notNull(),
    memoryLimitMb: integer("memory_limit_mb").notNull(),
    /** Expected difficulty on a Codeforces-like rating scale; used to normalise integrity features. */
    difficulty: integer("difficulty"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** Private setter notes: expected boilerplate, permitted snippets, known short solutions. */
    templateNotes: text("template_notes"),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (t) => [
    index("problem_author_idx").on(t.authorId),
    check("problem_time_limit_range", sql`${t.timeLimitMs} BETWEEN 100 AND 10000`),
    check("problem_memory_limit_range", sql`${t.memoryLimitMb} BETWEEN 16 AND 1024`),
    check("problem_difficulty_range", sql`${t.difficulty} IS NULL OR ${t.difficulty} BETWEEN 800 AND 3500`),
  ],
);

/** Sample tests shown in the statement. Public once the problem is visible. */
export const problemExample = pgTable(
  "problem_example",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problem.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    input: text("input").notNull(),
    output: text("output").notNull(),
    explanation: text("explanation"),
  },
  (t) => [unique("problem_example_ordinal_uq").on(t.problemId, t.ordinal)],
);

/** Hidden judge tests. Never returned by any contestant-facing query. */
export const problemTest = pgTable(
  "problem_test",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problem.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    input: text("input").notNull(),
    expectedOutput: text("expected_output").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("problem_test_ordinal_uq").on(t.problemId, t.ordinal),
    check("problem_test_input_size", sql`octet_length(${t.input}) <= ${sql.raw(String(MAX_TEST_FIELD_BYTES))}`),
    check(
      "problem_test_output_size",
      sql`octet_length(${t.expectedOutput}) <= ${sql.raw(String(MAX_TEST_FIELD_BYTES))}`,
    ),
  ],
);

/** One reference solution per language. Hidden, like tests. */
export const referenceSolution = pgTable(
  "reference_solution",
  {
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problem.id, { onDelete: "cascade" }),
    language: language("language").notNull(),
    source: text("source").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.problemId, t.language] })],
);

export const contest = pgTable(
  "contest",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: contestStatus("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (t) => [
    index("contest_status_starts_idx").on(t.status, t.startsAt),
    index("contest_created_by_idx").on(t.createdBy),
    check("contest_window_valid", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const contestProblem = pgTable(
  "contest_problem",
  {
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contest.id, { onDelete: "cascade" }),
    // RESTRICT: a problem used by a contest cannot be deleted out from under it.
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problem.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    ordinal: integer("ordinal").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.contestId, t.problemId] }),
    unique("contest_problem_label_uq").on(t.contestId, t.label),
    index("contest_problem_problem_idx").on(t.problemId),
  ],
);

export const contestParticipant = pgTable(
  "contest_participant",
  {
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contest.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.contestId, t.userId] }), index("contest_participant_user_idx").on(t.userId)],
);
