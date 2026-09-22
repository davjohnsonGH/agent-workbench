CREATE TABLE "model_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"model" text NOT NULL,
	"served_model" text,
	"system" text NOT NULL,
	"prompt" text NOT NULL,
	"output" jsonb,
	"error" text,
	"request_id" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_call" ADD CONSTRAINT "model_call_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_call_run_id_idx" ON "model_call" USING btree ("run_id");