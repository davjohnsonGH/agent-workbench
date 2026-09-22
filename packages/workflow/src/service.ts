import { executeAgentRun, type ModelProvider } from "@repo/agents";
import type { ArtifactType } from "@repo/artifacts";
import {
  type AgentRole,
  agentRun,
  approvalDecision,
  artifact,
  artifactVersion,
  type Db,
  modelCall,
  project,
} from "@repo/db";
import { and, asc, desc, eq, gt, inArray, ne } from "drizzle-orm";

import {
  type ArtifactSnapshot,
  computeWorkflowState,
  type ProjectSnapshot,
  type WorkflowState,
} from "./state";

/** Runs stuck in `running` longer than this (e.g. after a crash) stop blocking the step. */
const STALE_RUN_MS = 10 * 60 * 1000;

export class WorkflowError extends Error {
  constructor(
    readonly code: "not_found" | "conflict" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

export async function createProject(
  db: Db,
  input: { name: string; idea: string },
) {
  const [row] = await db.insert(project).values(input).returning();
  if (!row) throw new Error("Failed to create project");
  return row;
}

export function listProjects(db: Db) {
  return db.select().from(project).orderBy(desc(project.createdAt));
}

export async function getWorkflowState(
  db: Db,
  projectId: string,
): Promise<WorkflowState> {
  return computeWorkflowState(await loadSnapshot(db, projectId));
}

/** Everything the UI needs to show a project. */
export async function getProjectDetail(db: Db, projectId: string) {
  const [proj] = await db
    .select()
    .from(project)
    .where(eq(project.id, projectId));
  if (!proj) throw new WorkflowError("not_found", "Project not found");

  const versions = await db
    .select({
      id: artifactVersion.id,
      type: artifact.type,
      version: artifactVersion.version,
      status: artifactVersion.status,
      content: artifactVersion.content,
      producedByRunId: artifactVersion.producedByRunId,
      createdAt: artifactVersion.createdAt,
    })
    .from(artifactVersion)
    .innerJoin(artifact, eq(artifact.id, artifactVersion.artifactId))
    .where(eq(artifact.projectId, projectId))
    .orderBy(asc(artifact.type), desc(artifactVersion.version));

  const decisions = versions.length
    ? await db
        .select()
        .from(approvalDecision)
        .where(
          inArray(
            approvalDecision.artifactVersionId,
            versions.map((v) => v.id),
          ),
        )
    : [];

  const runs = await db
    .select()
    .from(agentRun)
    .where(eq(agentRun.projectId, projectId))
    .orderBy(desc(agentRun.createdAt));

  return {
    project: proj,
    workflow: await getWorkflowState(db, projectId),
    versions: versions.map((v) => ({
      ...v,
      decisions: decisions.filter((d) => d.artifactVersionId === v.id),
    })),
    runs,
  };
}

/** A run with its model calls (the trace) and the version it produced. */
export async function getRunDetail(db: Db, projectId: string, runId: string) {
  const [run] = await db
    .select()
    .from(agentRun)
    .where(and(eq(agentRun.id, runId), eq(agentRun.projectId, projectId)));
  if (!run) throw new WorkflowError("not_found", "Run not found");

  const calls = await db
    .select()
    .from(modelCall)
    .where(eq(modelCall.runId, runId))
    .orderBy(asc(modelCall.createdAt));

  const [version] = await db
    .select({ id: artifactVersion.id, version: artifactVersion.version })
    .from(artifactVersion)
    .where(eq(artifactVersion.producedByRunId, runId));

  return { run, calls, version: version ?? null };
}

/**
 * Record a human decision on a version awaiting approval. Approving
 * supersedes any previously approved version of the same artifact; rejecting
 * requires feedback, which the revision run receives.
 */
export async function decideVersion(
  db: Db,
  versionId: string,
  input: { decision: "approved" | "rejected"; feedback?: string },
) {
  const feedback = input.feedback?.trim() || null;
  if (input.decision === "rejected" && !feedback) {
    throw new WorkflowError("invalid", "Feedback is required when rejecting");
  }

  return db.transaction(async (tx) => {
    // Conditional update so two concurrent decisions cannot both succeed.
    const [version] = await tx
      .update(artifactVersion)
      .set({ status: input.decision })
      .where(
        and(
          eq(artifactVersion.id, versionId),
          eq(artifactVersion.status, "pending_approval"),
        ),
      )
      .returning();

    if (!version) {
      const [existing] = await tx
        .select({ status: artifactVersion.status })
        .from(artifactVersion)
        .where(eq(artifactVersion.id, versionId));
      throw existing
        ? new WorkflowError(
            "conflict",
            `Version is ${existing.status}, not awaiting approval`,
          )
        : new WorkflowError("not_found", "Version not found");
    }

    if (input.decision === "approved") {
      await tx
        .update(artifactVersion)
        .set({ status: "superseded" })
        .where(
          and(
            eq(artifactVersion.artifactId, version.artifactId),
            eq(artifactVersion.status, "approved"),
            ne(artifactVersion.id, version.id),
          ),
        );
    }

    const [decision] = await tx
      .insert(approvalDecision)
      .values({
        artifactVersionId: version.id,
        decision: input.decision,
        feedback,
      })
      .returning();

    return { version, decision: decision! };
  });
}

/** Run the agent for the workflow's next step, if the next step is a run. */
export async function runNextStep(
  db: Db,
  provider: ModelProvider,
  projectId: string,
) {
  const state = await getWorkflowState(db, projectId);
  const next = state.next;
  if (next.type !== "run") {
    throw new WorkflowError(
      "conflict",
      `Nothing to run: next action is "${next.type}"`,
    );
  }

  return executeAgentRun(db, provider, {
    projectId,
    role: next.role,
    revision: next.revision,
  });
}

async function loadSnapshot(
  db: Db,
  projectId: string,
): Promise<ProjectSnapshot> {
  const [proj] = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.id, projectId));
  if (!proj) throw new WorkflowError("not_found", "Project not found");

  const versions = await db
    .select({
      id: artifactVersion.id,
      type: artifact.type,
      version: artifactVersion.version,
      status: artifactVersion.status,
    })
    .from(artifactVersion)
    .innerJoin(artifact, eq(artifact.id, artifactVersion.artifactId))
    .where(eq(artifact.projectId, projectId))
    .orderBy(desc(artifactVersion.version));

  const artifacts: Partial<Record<ArtifactType, ArtifactSnapshot>> = {};
  for (const v of versions) {
    const entry = artifacts[v.type];
    if (!entry) {
      // Rows are newest first, so the first one per type is the latest.
      artifacts[v.type] = {
        latest: {
          id: v.id,
          version: v.version,
          status: v.status,
          feedback: null,
        },
        hasApproved: v.status === "approved",
      };
    } else if (v.status === "approved") {
      entry.hasApproved = true;
    }
  }

  for (const entry of Object.values(artifacts)) {
    if (entry.latest.status !== "rejected") continue;
    const [decision] = await db
      .select({ feedback: approvalDecision.feedback })
      .from(approvalDecision)
      .where(
        and(
          eq(approvalDecision.artifactVersionId, entry.latest.id),
          eq(approvalDecision.decision, "rejected"),
        ),
      )
      .orderBy(desc(approvalDecision.decidedAt))
      .limit(1);
    entry.latest.feedback = decision?.feedback ?? null;
  }

  const active = await db
    .selectDistinct({ role: agentRun.role })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.projectId, projectId),
        eq(agentRun.status, "running"),
        gt(agentRun.startedAt, new Date(Date.now() - STALE_RUN_MS)),
      ),
    );

  return {
    artifacts,
    activeRoles: active.map((r): AgentRole => r.role),
  };
}
