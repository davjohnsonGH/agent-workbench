ALTER TABLE "artifact_version" DROP CONSTRAINT "artifact_version_produced_by_run_agent_run_id_fk";
--> statement-breakpoint
ALTER TABLE "artifact_version_input" DROP CONSTRAINT "artifact_version_input_input_fk";
--> statement-breakpoint
ALTER TABLE "artifact_version" ADD CONSTRAINT "artifact_version_produced_by_run_agent_run_id_fk" FOREIGN KEY ("produced_by_run") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version_input" ADD CONSTRAINT "artifact_version_input_input_fk" FOREIGN KEY ("input_version_id") REFERENCES "public"."artifact_version"("id") ON DELETE cascade ON UPDATE no action;