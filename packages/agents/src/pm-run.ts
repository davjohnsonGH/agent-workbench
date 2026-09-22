import { randomUUID } from "node:crypto";

import {
  artifactRegistry,
  parseArtifactContent,
  type Requirements,
} from "@repo/artifacts";
import {
  agentRun,
  artifact,
  artifactVersion,
  artifactVersionInput,
  type Db,
  project,
} from "@repo/db";
import { and, desc, eq } from "drizzle-orm";

import {
  ModelOutputError,
  ModelRefusalError,
  type ModelProvider,
} from "./model";
import { generateRequirements } from "./pm-agent";

export interface PmRunParams {
  projectId: string;
  /** Revise an existing requirements version using reviewer feedback. */
  revision?: { versionId: string; feedback: string };
  idempotencyKey?: string;
}

export type AgentRunRow = typeof agentRun.$inferSelect;
export type ArtifactVersionRow = typeof artifactVersion.$inferSelect;

/**
 * Run the PM agent for a project and store its output as a new requirements
 * version awaiting approval. The run is recorded in `agent_run` whether it
 * succeeds or fails; on failure the error is rethrown.
 */
export async function executePmRun(
  db: Db,
  provider: ModelProvider,
  params: PmRunParams,
): Promise<{ run: AgentRunRow; version: ArtifactVersionRow }> {
  const [proj] = await db
    .select()
    .from(project)
    .where(eq(project.id, params.projectId));
  if (!proj) throw new Error(`Project ${params.projectId} not found`);

  const previous = params.revision
    ? await loadRequirementsVersion(db, params.revision.versionId)
    : undefined;

  const [run] = await db
    .insert(agentRun)
    .values({
      projectId: proj.id,
      role: "pm",
      status: "running",
      input: {
        revisionOf: params.revision?.versionId ?? null,
        feedback: params.revision?.feedback ?? null,
      },
      model: provider.model,
      traceId: randomUUID(),
      idempotencyKey: params.idempotencyKey,
      startedAt: new Date(),
    })
    .returning();
  if (!run) throw new Error("Failed to create agent run");

  let result;
  try {
    result = await generateRequirements(provider, {
      idea: proj.idea,
      revision:
        params.revision && previous
          ? { previous: previous.content, feedback: params.revision.feedback }
          : undefined,
    });
  } catch (error) {
    const usage =
      error instanceof ModelRefusalError || error instanceof ModelOutputError
        ? error.usage
        : undefined;
    await db
      .update(agentRun)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        finishedAt: new Date(),
      })
      .where(eq(agentRun.id, run.id));
    throw error;
  }

  return db.transaction(async (tx) => {
    await tx
      .insert(artifact)
      .values({ projectId: proj.id, type: "requirements" })
      .onConflictDoNothing();
    const [art] = await tx
      .select()
      .from(artifact)
      .where(
        and(eq(artifact.projectId, proj.id), eq(artifact.type, "requirements")),
      );
    if (!art) throw new Error("Failed to create requirements artifact");

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
        schemaVersion: artifactRegistry.requirements.schemaVersion,
        producedByRunId: run.id,
      })
      .returning();
    if (!version) throw new Error("Failed to create artifact version");

    if (previous) {
      await tx.insert(artifactVersionInput).values({
        artifactVersionId: version.id,
        inputVersionId: previous.id,
      });
    }

    const [finished] = await tx
      .update(agentRun)
      .set({
        status: "succeeded",
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        finishedAt: new Date(),
      })
      .where(eq(agentRun.id, run.id))
      .returning();
    if (!finished) throw new Error("Failed to update agent run");

    return { run: finished, version };
  });
}

async function loadRequirementsVersion(
  db: Db,
  versionId: string,
): Promise<{ id: string; content: Requirements }> {
  const [row] = await db
    .select({ id: artifactVersion.id, content: artifactVersion.content })
    .from(artifactVersion)
    .where(eq(artifactVersion.id, versionId));
  if (!row) throw new Error(`Artifact version ${versionId} not found`);
  const parsed = parseArtifactContent("requirements", row.content);
  if (!parsed.success) {
    throw new Error(`Artifact version ${versionId} is not valid requirements`);
  }
  return { id: row.id, content: parsed.data };
}
