CREATE TYPE "public"."contest_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('cpp17');--> statement-breakpoint
CREATE TABLE "contest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "contest_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contest_slug_unique" UNIQUE("slug"),
	CONSTRAINT "contest_window_valid" CHECK ("contest"."ends_at" > "contest"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "contest_participant" (
	"contest_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contest_participant_contest_id_user_id_pk" PRIMARY KEY("contest_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "contest_problem" (
	"contest_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"label" text NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "contest_problem_contest_id_problem_id_pk" PRIMARY KEY("contest_id","problem_id"),
	CONSTRAINT "contest_problem_label_uq" UNIQUE("contest_id","label")
);
--> statement-breakpoint
CREATE TABLE "problem" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"statement" text NOT NULL,
	"input_format" text NOT NULL,
	"output_format" text NOT NULL,
	"constraints" text DEFAULT '' NOT NULL,
	"notes" text,
	"time_limit_ms" integer NOT NULL,
	"memory_limit_mb" integer NOT NULL,
	"difficulty" integer,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"template_notes" text,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problem_slug_unique" UNIQUE("slug"),
	CONSTRAINT "problem_time_limit_range" CHECK ("problem"."time_limit_ms" BETWEEN 100 AND 10000),
	CONSTRAINT "problem_memory_limit_range" CHECK ("problem"."memory_limit_mb" BETWEEN 16 AND 1024),
	CONSTRAINT "problem_difficulty_range" CHECK ("problem"."difficulty" IS NULL OR "problem"."difficulty" BETWEEN 800 AND 3500)
);
--> statement-breakpoint
CREATE TABLE "problem_example" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"problem_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"input" text NOT NULL,
	"output" text NOT NULL,
	"explanation" text,
	CONSTRAINT "problem_example_ordinal_uq" UNIQUE("problem_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "problem_test" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"problem_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"input" text NOT NULL,
	"expected_output" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problem_test_ordinal_uq" UNIQUE("problem_id","ordinal"),
	CONSTRAINT "problem_test_input_size" CHECK (octet_length("problem_test"."input") <= 262144),
	CONSTRAINT "problem_test_output_size" CHECK (octet_length("problem_test"."expected_output") <= 262144)
);
--> statement-breakpoint
CREATE TABLE "reference_solution" (
	"problem_id" uuid NOT NULL,
	"language" "language" NOT NULL,
	"source" text NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_solution_problem_id_language_pk" PRIMARY KEY("problem_id","language")
);
--> statement-breakpoint
ALTER TABLE "contest" ADD CONSTRAINT "contest_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_participant" ADD CONSTRAINT "contest_participant_contest_id_contest_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_participant" ADD CONSTRAINT "contest_participant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_problem" ADD CONSTRAINT "contest_problem_contest_id_contest_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_problem" ADD CONSTRAINT "contest_problem_problem_id_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problem"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem" ADD CONSTRAINT "problem_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_example" ADD CONSTRAINT "problem_example_problem_id_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_test" ADD CONSTRAINT "problem_test_problem_id_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_solution" ADD CONSTRAINT "reference_solution_problem_id_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_solution" ADD CONSTRAINT "reference_solution_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contest_status_starts_idx" ON "contest" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "contest_created_by_idx" ON "contest" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "contest_participant_user_idx" ON "contest_participant" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "contest_problem_problem_idx" ON "contest_problem" USING btree ("problem_id");--> statement-breakpoint
CREATE INDEX "problem_author_idx" ON "problem" USING btree ("author_id");