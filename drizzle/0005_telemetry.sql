CREATE TYPE "public"."telemetry_event_type" AS ENUM('session_start', 'edit', 'snapshot', 'focus', 'blur', 'visibility', 'heartbeat', 'run', 'submit');--> statement-breakpoint
CREATE TABLE "code_snapshot" (
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"source" text NOT NULL,
	"source_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_snapshot_session_id_seq_pk" PRIMARY KEY("session_id","seq"),
	CONSTRAINT "code_snapshot_hash" CHECK ("code_snapshot"."source_sha256" = encode(sha256(convert_to("code_snapshot"."source", 'UTF8')), 'hex')),
	CONSTRAINT "code_snapshot_size" CHECK (octet_length("code_snapshot"."source") <= 65536)
);
--> statement-breakpoint
CREATE TABLE "ide_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"contest_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"notice_version" text NOT NULL,
	"user_agent" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_started_at" timestamp with time zone,
	"max_seq" integer DEFAULT -1 NOT NULL,
	"received_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"last_received_at" timestamp with time zone,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "telemetry_acknowledgement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"contest_id" uuid NOT NULL,
	"notice_version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_event" (
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" "telemetry_event_type" NOT NULL,
	"client_ts" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"arrival" integer NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "telemetry_event_session_id_seq_pk" PRIMARY KEY("session_id","seq")
);
--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "ide_session_id" uuid;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "ide_seq" integer;--> statement-breakpoint
ALTER TABLE "code_snapshot" ADD CONSTRAINT "code_snapshot_session_id_ide_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ide_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ide_session" ADD CONSTRAINT "ide_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ide_session" ADD CONSTRAINT "ide_session_contest_id_contest_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contest"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ide_session" ADD CONSTRAINT "ide_session_problem_id_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problem"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_acknowledgement" ADD CONSTRAINT "telemetry_acknowledgement_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_acknowledgement" ADD CONSTRAINT "telemetry_acknowledgement_contest_id_contest_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_event" ADD CONSTRAINT "telemetry_event_session_id_ide_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ide_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ide_session_user_contest_idx" ON "ide_session" USING btree ("user_id","contest_id","started_at");--> statement-breakpoint
CREATE INDEX "ide_session_started_idx" ON "ide_session" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "telemetry_ack_user_contest_idx" ON "telemetry_acknowledgement" USING btree ("user_id","contest_id","notice_version");--> statement-breakpoint
CREATE INDEX "telemetry_event_received_idx" ON "telemetry_event" USING btree ("received_at");--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_ide_session_id_ide_session_id_fk" FOREIGN KEY ("ide_session_id") REFERENCES "public"."ide_session"("id") ON DELETE restrict ON UPDATE no action;