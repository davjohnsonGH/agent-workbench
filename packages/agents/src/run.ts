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
  project,
} from "@repo/db";
import { and, desc, eq } from "drizzle-orm";

import { type AgentInputs, generateArtifact } from "./definition";
import {
  ModelOutputError,
  ModelRefusalError,
  type ModelProvider,
} from "./model";
import { agents } from "./registry";

export interface AgentRunParams {
  projectId: string;
  role: AgentRole;
  /** Revise an existing version of the agent's artifact using reviewer feedback. */
  revision?: { versionId: string; feedback: string };
  idempotencyKey?: string;
}

export type AgentRunRow = typeof agentRun.$inferSelect;
export type ArtifactVersionRow = typeof artifactVersion.$inferSelect;

interface LoadedVersion {
  id: string;
  content: ArtifactContent[ArtifactType];
}

/**
 * Run an agent for a project and store its output as a new version of its
 * artifact, awaiting approval. The agent receives the latest approved version
 * of each input artifact; the new version records those inputs (and the
 * version it revises) as lineage. The run is recorded in `agent_run` whether
 * it succeeds or fails; on failure the error is rethrown.
 */
export async function executeAgentRun(
  db: Db,
  provider: ModelProvider,
  params: AgentRunParams,
): Promise<{ run: AgentRunRow; version: ArtifactVersionRow }> {
  const agent = agents[params.role];

  const [proj] = await db
    .select()
    .from(project)
    .where(eq(project.id, params.projectId));
  if (!proj) throw new Error(`Project ${params.projectId} not found`);

  const inputs: AgentInputs = {};
  const inputVersions: LoadedVersion[] = [];
  for (const type of agent.inputs) {
    const loaded = await loadApprovedVersion(db, proj.id, type);
    Object.assign(inputs, { [type]: loaded.content });
    inputVersions.push(loaded);
  }

  const previous = params.revision
    ? await loadVersion(db, params.revision.versionId, agent.produces)
    : undefined;

  const [run] = await db
    .insert(agentRun)
    .values({
      projectId: proj.id,
      role: agent.role,
      status: "running",
      input: {
        inputVersionIds: inputVersions.map((v) => v.id),
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
    result = await generateArtifact(provider, agent, {
      idea: proj.idea,
      inputs,
      revision:
        params.revision && previous
          ? { previous: previous.content, feedback: params.revision.feedback }
          : undefined,
    });
    const problems = agent.check?.(result.output, inputs) ?? [];
    if (problems.length > 0) {
      throw new ModelOutputError(problems.join("; "), result.usage);
    }
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
        producedByRunId: run.id,
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
