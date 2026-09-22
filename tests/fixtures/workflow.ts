import { randomUUID } from "node:crypto";

import type { ModelProvider } from "@repo/agents";
import { agentRun, artifactVersion, type Db } from "@repo/db";
import { processNextJob } from "@repo/queue";
import { agentJobHandlers, enqueueNextStep } from "@repo/workflow";
import { eq } from "drizzle-orm";

/** A unique queue name, so tests never process each other's jobs. */
export const testQueue = () => `test-${randomUUID()}`;

/** Process one job from `queue` the way the worker does (no retry delay). */
export function processOne(db: Db, provider: ModelProvider, queue: string) {
  return processNextJob(db, {
    queue,
    workerId: "test-worker",
    handlers: agentJobHandlers(db, provider),
    backoff: () => 0,
  });
}

/**
 * Queue the next workflow step and process it immediately, returning the run
 * and the version it produced. Throws if the run does not succeed.
 */
export async function runNextStepNow(
  db: Db,
  provider: ModelProvider,
  projectId: string,
  queue: string,
) {
  const queued = await enqueueNextStep(db, projectId, { queue });
  const result = await processOne(db, provider, queue);
  if (result.outcome !== "succeeded") {
    throw result.outcome === "idle"
      ? new Error("No job was processed")
      : result.error;
  }
  const [run] = await db
    .select()
    .from(agentRun)
    .where(eq(agentRun.id, queued.id));
  const [version] = await db
    .select()
    .from(artifactVersion)
    .where(eq(artifactVersion.producedByRunId, queued.id));
  return { run: run!, version: version! };
}
