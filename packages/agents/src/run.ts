import { randomUUID } from "node:crypto";

import {
  type ArtifactContent,
  artifactRegistry,
  type ArtifactType,
  parseArtifactContent,
} from "@repo/artifacts";
import {
  type AgentRole,
  agentRun,
  artifact,
  artifactVersion,
  artifactVersionInput,
  type Db,
  type DbOrTx,
  modelCall,
  project,
} from "@repo/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { type AgentInputs, buildAgentRequest } from "./definition";
import {
  ModelOutputError,
  ModelRefusalError,
  type ModelProvider,
  type StructuredResponse,
} from "./model";
import { agents } from "./registry";

export interface AgentRunParams {
  projectId: string;
  role: AgentRole;
  /** Revise an existing version of the agent's artifact using reviewer feedback. */
  revision?: { versionId: string; feedback: string };
}

export type AgentRunRow = typeof agentRun.$inferSelect;
export type ArtifactVersionRow = typeof artifactVersion.$inferSelect;
export interface AgentRunResult {
  run: AgentRunRow;
  version: ArtifactVersionRow;
}

const runInputSchema = z.object({
  revisionOf: z.string().nullable(),
  feedback: z.string().nullable(),
});

interface LoadedVersion {
  id: string;
  content: ArtifactContent[ArtifactType];
}

/**
 * Create a queued run. Fails with a unique violation on
 * `agent_run_one_active_per_role` if the role already has an active run.
 */
export async function createAgentRun(
  db: DbOrTx,
  params: AgentRunParams,
): Promise<AgentRunRow> {
  const [run] = await db
    .insert(agentRun)
    .values({
      projectId: params.projectId,
      role: params.role,
      status: "queued",
      input: {
        revisionOf: params.revision?.versionId ?? null,
        feedback: params.revision?.feedback ?? null,
      },
      traceId: randomUUID(),
    })
    .returning();
  if (!run) throw new Error("Failed to create agent run");
  return run;
}

/**
 * Execute a queued run: give the agent the latest approved version of each
 * input artifact, call the model, and store the output as a new version of the
 * agent's artifact awaiting approval, with lineage to its inputs and to the
 * version it revises. Every model call is traced in `model_call`.
 *
 * Idempotent: executing a run that already succeeded returns its result
 * without calling the model (e.g. when a worker crashed after committing).
 * On failure the error is recorded on the run, which stays `running`, and
 * rethrown; the caller decides whether to retry (`requeueAgentRun`) or give
 * up (`failAgentRun`).
 */
export async function executeAgentRun(
  db: Db,
  provider: ModelProvider,
  runId: string,
): Promise<AgentRunResult> {
  const [existing] = await db
    .select()
    .from(agentRun)
    .where(eq(agentRun.id, runId));
  if (!existing) throw new Error(`Run ${runId} not found`);
  if (existing.status === "succeeded") return loadResult(db, existing);
  if (existing.status === "failed") throw new Error(`Run ${runId} has failed`);

  const agent = agents[existing.role];
  const input = runInputSchema.parse(existing.input);

  const [proj] = await db
    .select()
    .from(project)
    .where(eq(project.id, existing.projectId));
  if (!proj) throw new Error(`Project ${existing.projectId} not found`);

  const inputs: AgentInputs = {};
  const inputVersions: LoadedVersion[] = [];
  for (const type of agent.inputs) {
    const loaded = await loadApprovedVersion(db, proj.id, type);
    Object.assign(inputs, { [type]: loaded.content });
    inputVersions.push(loaded);
  }
  const previous = input.revisionOf
    ? await loadVersion(db, input.revisionOf, agent.produces)
    : undefined;

  const [run] = await db
    .update(agentRun)
    .set({
      status: "running",
      model: provider.model,
      input: { ...input, inputVersionIds: inputVersions.map((v) => v.id) },
      startedAt: sql`coalesce(${agentRun.startedAt}, now())`,
      error: null,
    })
    .where(eq(agentRun.id, runId))
    .returning();
  if (!run) throw new Error(`Run ${runId} not found`);

  const request = buildAgentRequest(agent, {
    idea: proj.idea,
    inputs,
    revision:
      previous && input.feedback !== null
        ? { previous: previous.content, feedback: input.feedback }
        : undefined,
  });
  const call = {
    runId,
    model: provider.model,
    system: request.system,
    prompt: request.prompt,
  };
  const startedAt = Date.now();

  let result: StructuredResponse<ArtifactContent[ArtifactType]> | undefined;
  try {
    result = await provider.generateStructured(request);
    const problems = agent.check?.(result.output, inputs) ?? [];
    if (problems.length > 0) {
      throw new ModelOutputError(problems.join("; "), result.usage, {
        requestId: result.requestId,
      });
    }
  } catch (error) {
    const usage =
      error instanceof ModelRefusalError || error instanceof ModelOutputError
        ? error.usage
        : undefined;
    await db.transaction(async (tx) => {
      await tx.insert(modelCall).values({
        ...call,
        servedModel: result?.model,
        output: result?.output,
        error: errorMessage(error),
        requestId: requestIdOf(error),
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        latencyMs: Date.now() - startedAt,
      });
      await tx
        .update(agentRun)
        .set({ error: errorMessage(error), ...(await tokenTotals(tx, runId)) })
        .where(eq(agentRun.id, runId));
    });
    throw error;
  }
  const latencyMs = Date.now() - startedAt;

  return db.transaction(async (tx) => {
    await tx
      .insert(artifact)
      .values({ projectId: proj.id, type: agent.produces })
      .onConflictDoNothing();
    const [art] = await tx
      .select()
      .from(artifact)
      .where(
        and(eq(artifact.projectId, proj.id), eq(artifact.type, agent.produces)),
      );
    if (!art) throw new Error(`Failed to create ${agent.produces} artifact`);

    const [latest] = await tx
      .select({ version: artifactVersion.version })
      .from(artifactVersion)
      .where(eq(artifactVersion.artifactId, art.id))
      .orderBy(desc(artifactVersion.version))
      .limit(1);

    const [version] = await tx
      .insert(artifactVersion)
      .values({
        artifactId: art.id,
        version: (latest?.version ?? 0) + 1,
        status: "pending_approval",
        content: result.output,
        schemaVersion: artifactRegistry[agent.produces].schemaVersion,
        producedByRunId: runId,
      })
      .returning();
    if (!version) throw new Error("Failed to create artifact version");

    const lineage = [...inputVersions, ...(previous ? [previous] : [])];
    if (lineage.length > 0) {
      await tx.insert(artifactVersionInput).values(
        lineage.map((input) => ({
          artifactVersionId: version.id,
          inputVersionId: input.id,
        })),
      );
    }

    await tx.insert(modelCall).values({
      ...call,
      servedModel: result.model,
      output: result.output,
      requestId: result.requestId,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs,
    });

    // Marking the run succeeded in the same transaction as the version is
    // what makes re-execution safe (see the idempotency check above).
    const [finished] = await tx
      .update(agentRun)
      .set({
        status: "succeeded",
        model: result.model,
        error: null,
        finishedAt: new Date(),
        ...(await tokenTotals(tx, runId)),
      })
      .where(eq(agentRun.id, runId))
      .returning();
    if (!finished) throw new Error("Failed to update agent run");

    return { run: finished, version };
  });
}

/** Put a run back in the queue after a failed attempt that will be retried. */
export async function requeueAgentRun(
  db: DbOrTx,
  runId: string,
  error: unknown,
): Promise<void> {
  await db
    .update(agentRun)
    .set({ status: "queued", error: errorMessage(error) })
    .where(and(eq(agentRun.id, runId), eq(agentRun.status, "running")));
}

/** Mark a run permanently failed. Idempotent; never overwrites a success. */
export async function failAgentRun(
  db: DbOrTx,
  runId: string,
  error: unknown,
): Promise<void> {
  await db
    .update(agentRun)
    .set({
      status: "failed",
      error: errorMessage(error),
      finishedAt: sql`coalesce(${agentRun.finishedAt}, now())`,
      ...(await tokenTotals(db, runId)),
    })
    .where(and(eq(agentRun.id, runId), sql`${agentRun.status} <> 'succeeded'`));
}

/**
 * Create and execute a run in-process, without the queue (scripts and tests).
 * A failure marks the run failed and is rethrown.
 */
export async function runAgent(
  db: Db,
  provider: ModelProvider,
  params: AgentRunParams,
): Promise<AgentRunResult> {
  const run = await createAgentRun(db, params);
  try {
    return await executeAgentRun(db, provider, run.id);
  } catch (error) {
    await failAgentRun(db, run.id, error);
    throw error;
  }
}

/** A run's token usage summed over all its model calls. */
async function tokenTotals(db: DbOrTx, runId: string) {
  const [totals] = await db
    .select({
      inputTokens: sql<number>`coalesce(sum(${modelCall.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${modelCall.outputTokens}), 0)::int`,
    })
    .from(modelCall)
    .where(eq(modelCall.runId, runId));
  return totals ?? { inputTokens: 0, outputTokens: 0 };
}

async function loadResult(db: Db, run: AgentRunRow): Promise<AgentRunResult> {
  const [version] = await db
    .select()
    .from(artifactVersion)
    .where(eq(artifactVersion.producedByRunId, run.id));
  if (!version) throw new Error(`Run ${run.id} succeeded without a version`);
  return { run, version };
}

/** The latest approved version of an artifact type in a project. */
async function loadApprovedVersion(
  db: Db,
  projectId: string,
  type: ArtifactType,
): Promise<LoadedVersion> {
  const [row] = await db
    .select({ id: artifactVersion.id })
    .from(artifactVersion)
    .innerJoin(artifact, eq(artifact.id, artifactVersion.artifactId))
    .where(
      and(
        eq(artifact.projectId, projectId),
        eq(artifact.type, type),
        eq(artifactVersion.status, "approved"),
      ),
    )
    .orderBy(desc(artifactVersion.version))
    .limit(1);
  if (!row) throw new Error(`No approved ${type} for project ${projectId}`);
  return loadVersion(db, row.id, type);
}

async function loadVersion(
  db: Db,
  versionId: string,
  type: ArtifactType,
): Promise<LoadedVersion> {
  const [row] = await db
    .select({ id: artifactVersion.id, content: artifactVersion.content })
    .from(artifactVersion)
    .where(eq(artifactVersion.id, versionId));
  if (!row) throw new Error(`Artifact version ${versionId} not found`);
  const parsed = parseArtifactContent(type, row.content);
  if (!parsed.success) {
    throw new Error(`Artifact version ${versionId} is not a valid ${type}`);
  }
  return { id: row.id, content: parsed.data };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Provider request id from a model error or an SDK API error, if any. */
function requestIdOf(error: unknown): string | null {
  if (error instanceof ModelRefusalError || error instanceof ModelOutputError) {
    return error.requestId ?? null;
  }
  if (typeof error === "object" && error !== null && "requestID" in error) {
    return (error as { requestID?: string | null }).requestID ?? null;
  }
  return null;
}
