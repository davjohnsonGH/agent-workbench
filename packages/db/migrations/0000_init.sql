CREATE TABLE "agent_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"input" jsonb NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"error" text,
	"trace_id" text,
	"idempotency_key" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_run_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "approval_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_version_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"feedback" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_project_id_type_unique" UNIQUE("project_id","type")
);
--> statement-breakpoint
CREATE TABLE "artifact_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"content" jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"produced_by_run" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_version_artifact_id_version_unique" UNIQUE("artifact_id","version")
);
--> statement-breakpoint
CREATE TABLE "artifact_version_input" (
	"artifact_version_id" uuid NOT NULL,
	"input_version_id" uuid NOT NULL,
	CONSTRAINT "artifact_version_input_pk" PRIMARY KEY("artifact_version_id","input_version_id")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"idea" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decision" ADD CONSTRAINT "approval_decision_artifact_version_id_artifact_version_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version" ADD CONSTRAINT "artifact_version_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version" ADD CONSTRAINT "artifact_version_produced_by_run_agent_run_id_fk" FOREIGN KEY ("produced_by_run") REFERENCES "public"."agent_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version_input" ADD CONSTRAINT "artifact_version_input_version_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version_input" ADD CONSTRAINT "artifact_version_input_input_fk" FOREIGN KEY ("input_version_id") REFERENCES "public"."artifact_version"("id") ON DELETE no action ON UPDATE no action;