import {
  createAgentRun,
  executeAgentRun,
  failAgentRun,
  isRetryableModelError,
  type ModelProvider,
  requeueAgentRun,
} from "@repo/agents";
import type { ArtifactType } from "@repo/artifacts";
import {
  agentRun,
  approvalDecision,
  artifact,
  artifactVersion,
  type Db,
  job,
  modelCall,
  project,
} from "@repo/db";
import { enqueue, type JobHandler, type JobRow } from "@repo/queue";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import {
  type ArtifactSnapshot,
  computeWorkflowState,
  type ProjectSnapshot,
  type WorkflowState,
} from "./state";

/** Queue that agent-run jobs go to; the worker processes it. */
export const AGENT_QUEUE = "agents";
const AGENT_RUN_JOB = "agent_run";

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

/** A run with its model calls (the trace), queue job, and the version it produced. */
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

  const [runJob] = await db
    .select()
    .from(job)
    .where(sql`${job.payload}->>'runId' = ${runId}`)
    .orderBy(desc(job.createdAt))
    .limit(1);

  return { run, calls, version: version ?? null, job: runJob ?? null };
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

/**
 * Queue the agent for the workflow's next step, if the next step is a run.
 * The run and its job are created in one transaction; the worker executes it.
 * A second request while the role has an active run is rejected by the
 * database (`agent_run_one_active_per_role`), not just by the state check.
 */
export async function enqueueNextStep(
  db: Db,
  projectId: string,
  options: { queue?: string } = {},
) {
  const { next } = await getWorkflowState(db, projectId);
  if (next.type !== "run") {
    throw new WorkflowError(
      "conflict",
      `Nothing to run: next action is "${next.type}"`,
    );
  }

  try {
    return await db.transaction(async (tx) => {
      const run = await createAgentRun(tx, {
        projectId,
        role: next.role,
        revision: next.revision,
      });
      await enqueue(tx, {
        queue: options.queue ?? AGENT_QUEUE,
        type: AGENT_RUN_JOB,
        payload: { runId: run.id },
      });
      return run;
    });
  } catch (error) {
    if (isUniqueViolation(error, "agent_run_one_active_per_role")) {
      throw new WorkflowError("conflict", "This agent is already running");
    }
    throw error;
  }
}

/** Job handlers the worker registers for the agent queue. */
export function agentJobHandlers(
  db: Db,
  provider: ModelProvider,
): Record<string, JobHandler> {
  const runIdOf = (job: JobRow) =>
    z.object({ runId: z.string() }).parse(job.payload).runId;
  return {
    [AGENT_RUN_JOB]: {
      async run(job) {
        await executeAgentRun(db, provider, runIdOf(job));
      },
      isRetryable: isRetryableModelError,
      onRetry: (job, error) => requeueAgentRun(db, runIdOf(job), error),
      onFailed: (job, error) => failAgentRun(db, runIdOf(job), error),
    },
  };
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  // Drizzle wraps driver errors; the Postgres error is the cause.
  const pgError = (error as { cause?: unknown })?.cause ?? error;
  return (
    typeof pgError === "object" &&
    pgError !== null &&
    (pgError as { code?: string }).code === "23505" &&
    (pgError as { constraint_name?: string }).constraint_name === constraint
  );
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
    .select({ role: agentRun.role, status: agentRun.status })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.projectId, projectId),
        inArray(agentRun.status, ["queued", "running"]),
      ),
    );

  return {
    artifacts,
    activeRuns: active.map((r) => ({
      role: r.role,
      status:
        r.status === "queued" ? ("queued" as const) : ("running" as const),
    })),
  };
}
