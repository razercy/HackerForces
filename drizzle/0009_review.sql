CREATE TYPE "public"."confirmation_verdict" AS ENUM('confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."review_case_status" AS ENUM('open', 'awaiting_confirmation', 'closed');--> statement-breakpoint
CREATE TYPE "public"."review_outcome" AS ENUM('no_concern', 'inconclusive', 'confirmed_violation');--> statement-breakpoint
CREATE TABLE "contestant_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contestant_response_len" CHECK (char_length("contestant_response"."body") BETWEEN 1 AND 5000)
);
--> statement-breakpoint
CREATE TABLE "decision_confirmation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"admin_id" text NOT NULL,
	"verdict" "confirmation_verdict" NOT NULL,
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_confirmation_decision_id_unique" UNIQUE("decision_id"),
	CONSTRAINT "decision_confirmation_rationale_len" CHECK (char_length("decision_confirmation"."rationale") BETWEEN 10 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "review_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"contest_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"status" "review_case_status" DEFAULT 'open' NOT NULL,
	"opened_reason" text NOT NULL,
	"opened_by" text,
	"assessment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"outcome" "review_outcome" NOT NULL,
	"rationale" text NOT NULL,
	"assessment_id" uuid,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_decision_rationale_len" CHECK (char_length("review_decision"."rationale") BETWEEN 30 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "review_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_note_len" CHECK (char_length("review_note"."body") BETWEEN 1 AND 5000)
);
--> statement-breakpoint
ALTER TABLE "contestant_response" ADD CONSTRAINT "contestant_response_case_id_review_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_case"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contestant_response" ADD CONSTRAINT "contestant_response_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_confirmation" ADD CONSTRAINT "decision_confirmation_decision_id_review_decision_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."review_decision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_confirmation" ADD CONSTRAINT "decision_confirmation_admin_id_user_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_case" ADD CONSTRAINT "review_case_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_case" ADD CONSTRAINT "review_case_contest_id_contest_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contest"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_case" ADD CONSTRAINT "review_case_problem_id_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problem"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_case" ADD CONSTRAINT "review_case_opened_by_user_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_case" ADD CONSTRAINT "review_case_assessment_id_anomaly_assessment_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."anomaly_assessment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_case_id_review_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_case"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_assessment_id_anomaly_assessment_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."anomaly_assessment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_note" ADD CONSTRAINT "review_note_case_id_review_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."review_case"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_note" ADD CONSTRAINT "review_note_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contestant_response_case_idx" ON "contestant_response" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_case_one_active_uq" ON "review_case" USING btree ("user_id","contest_id","problem_id") WHERE "review_case"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX "review_case_queue_idx" ON "review_case" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "review_case_subject_idx" ON "review_case" USING btree ("user_id","contest_id","problem_id");--> statement-breakpoint
CREATE INDEX "review_decision_case_idx" ON "review_decision" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "review_note_case_idx" ON "review_note" USING btree ("case_id","created_at");