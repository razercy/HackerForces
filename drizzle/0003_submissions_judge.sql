CREATE TYPE "public"."judge_job_status" AS ENUM('pending', 'claimed', 'done', 'dead');--> statement-breakpoint
CREATE TYPE "public"."submission_kind" AS ENUM('submission', 'sample_run');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('queued', 'running', 'judged', 'failed');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded', 'runtime_error', 'compilation_error');--> statement-breakpoint
CREATE TABLE "judge_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"status" "judge_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judge_job_submission_id_unique" UNIQUE("submission_id")
);
--> statement-breakpoint
CREATE TABLE "submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"kind" "submission_kind" NOT NULL,
	"language" "language" NOT NULL,
	"source" text NOT NULL,
	"source_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "submission_status" DEFAULT 'queued' NOT NULL,
	"verdict" "verdict",
	"time_ms" integer,
	"memory_kb" integer,
	"passed_tests" integer,
	"total_tests" integer,
	"failed_test" integer,
	"compile_output" text,
	"judge_provider" text,
	"judged_at" timestamp with time zone,
	CONSTRAINT "submission_source_size" CHECK (octet_length("submission"."source") <= 65536),
	CONSTRAINT "submission_source_hash" CHECK ("submission"."source_sha256" = encode(sha256(convert_to("submission"."source", 'UTF8')), 'hex')),
	CONSTRAINT "submission_compile_output_size" CHECK ("submission"."compile_output" IS NULL OR octet_length("submission"."compile_output") <= 16384)
);
--> statement-breakpoint
ALTER TABLE "judge_job" ADD CONSTRAINT "judge_job_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_contest_id_contest_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contest"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_problem_id_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problem"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "judge_job_claim_idx" ON "judge_job" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "submission_user_contest_idx" ON "submission" USING btree ("user_id","contest_id","created_at");--> statement-breakpoint
CREATE INDEX "submission_contest_problem_idx" ON "submission" USING btree ("contest_id","problem_id","created_at");