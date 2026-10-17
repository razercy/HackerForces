CREATE TYPE "public"."analysis_job_status" AS ENUM('pending', 'claimed', 'done', 'dead');--> statement-breakpoint
CREATE TYPE "public"."assessment_band" AS ENUM('typical', 'elevated', 'insufficient_data');--> statement-breakpoint
CREATE TABLE "analysis_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"contest_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"status" "analysis_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"rerun_requested" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_job_subject_uq" UNIQUE("user_id","contest_id","problem_id")
);
--> statement-breakpoint
CREATE TABLE "anomaly_assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature_vector_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"contest_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"ruleset_version" text NOT NULL,
	"score" real,
	"band" "assessment_band" NOT NULL,
	"reference_digest" text NOT NULL,
	"reference" jsonb NOT NULL,
	"contributions" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anomaly_assessment_score_range" CHECK ("anomaly_assessment"."score" IS NULL OR ("anomaly_assessment"."score" >= 0 AND "anomaly_assessment"."score" <= 100))
);
--> statement-breakpoint
CREATE TABLE "approved_snippet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"source_sha256" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "approved_snippet_hash" CHECK ("approved_snippet"."source_sha256" = encode(sha256(convert_to("approved_snippet"."source", 'UTF8')), 'hex')),
	CONSTRAINT "approved_snippet_size" CHECK (octet_length("approved_snippet"."source") <= 65536)
);
--> statement-breakpoint
CREATE TABLE "feature_vector" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"contest_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"feature_set_version" text NOT NULL,
	"inputs_digest" text NOT NULL,
	"features" jsonb NOT NULL,
	"data_quality" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_vector_inputs_uq" UNIQUE("user_id","contest_id","problem_id","feature_set_version","inputs_digest")
);
--> statement-breakpoint
CREATE TABLE "user_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_template_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_template_version_hash" CHECK ("user_template_version"."source_sha256" = encode(sha256(convert_to("user_template_version"."source", 'UTF8')), 'hex')),
	CONSTRAINT "user_template_version_size" CHECK (octet_length("user_template_version"."source") <= 65536)
);
--> statement-breakpoint
ALTER TABLE "analysis_job" ADD CONSTRAINT "analysis_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_job" ADD CONSTRAINT "analysis_job_contest_id_contest_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_job" ADD CONSTRAINT "analysis_job_problem_id_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly_assessment" ADD CONSTRAINT "anomaly_assessment_feature_vector_id_feature_vector_id_fk" FOREIGN KEY ("feature_vector_id") REFERENCES "public"."feature_vector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly_assessment" ADD CONSTRAINT "anomaly_assessment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly_assessment" ADD CONSTRAINT "anomaly_assessment_contest_id_contest_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly_assessment" ADD CONSTRAINT "anomaly_assessment_problem_id_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_snippet" ADD CONSTRAINT "approved_snippet_contest_id_contest_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_snippet" ADD CONSTRAINT "approved_snippet_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_vector" ADD CONSTRAINT "feature_vector_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_vector" ADD CONSTRAINT "feature_vector_contest_id_contest_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_vector" ADD CONSTRAINT "feature_vector_problem_id_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_template" ADD CONSTRAINT "user_template_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_template_version" ADD CONSTRAINT "user_template_version_template_id_user_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."user_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_job_claim_idx" ON "analysis_job" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "anomaly_assessment_subject_idx" ON "anomaly_assessment" USING btree ("user_id","contest_id","problem_id","computed_at");--> statement-breakpoint
CREATE INDEX "anomaly_assessment_queue_idx" ON "anomaly_assessment" USING btree ("contest_id","band","score");--> statement-breakpoint
CREATE INDEX "approved_snippet_contest_idx" ON "approved_snippet" USING btree ("contest_id");--> statement-breakpoint
CREATE INDEX "feature_vector_cohort_idx" ON "feature_vector" USING btree ("contest_id","problem_id","feature_set_version","computed_at");--> statement-breakpoint
CREATE INDEX "user_template_user_idx" ON "user_template" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_template_version_template_idx" ON "user_template_version" USING btree ("template_id","created_at");