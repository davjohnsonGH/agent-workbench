/**
 * Background worker: processes agent runs from the job queue (ADR-0005).
 * Run several for parallelism; they coordinate through Postgres. SIGINT or
 * SIGTERM stops claiming new jobs and lets the current one finish.
 */
import { hostname } from "node:os";

import { AnthropicProvider } from "@repo/agents";
import { createDb } from "@repo/db";
import { runWorker } from "@repo/queue";
import { AGENT_QUEUE, agentJobHandlers } from "@repo/workflow";

try {
  process.loadEnvFile("../../.env");
} catch {
  // No .env file; variables come from the environment.
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const db = createDb(databaseUrl);
const provider = new AnthropicProvider({
  model: process.env.AGENT_MODEL,
  workspaceId: process.env.ANTHROPIC_WORKSPACE_ID,
});
const workerId = `${hostname()}:${process.pid}`;

function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      time: new Date().toISOString(),
      workerId,
      event,
      ...fields,
    }),
  );
}

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    log("shutdown", { signal });
    controller.abort();
  });
}

log("start", { queue: AGENT_QUEUE, model: provider.model });
await runWorker(db, {
  queue: AGENT_QUEUE,
  workerId,
  handlers: agentJobHandlers(db, provider),
  signal: controller.signal,
  onOutcome(result) {
    if (result.outcome === "idle") return;
    log(`job_${result.outcome}`, {
      jobId: result.job.id,
      type: result.job.type,
      attempt: result.job.attempts,
      payload: result.job.payload,
      error:
        result.error instanceof Error ? result.error.message : result.error,
    });
  },
  onError(error) {
    log("worker_error", {
      error: error instanceof Error ? error.message : String(error),
    });
  },
});
await db.$client.end();
log("stopped");
