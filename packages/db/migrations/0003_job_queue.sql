CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text DEFAULT 'default' NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "job_claim_idx" ON "job" USING btree ("queue","status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_one_active_per_role" ON "agent_run" USING btree ("project_id","role") WHERE "agent_run"."status" in ('queued', 'running');