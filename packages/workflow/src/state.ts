import { agents } from "@repo/agents";
import type { ArtifactType } from "@repo/artifacts";
import type { AgentRole, ArtifactVersionStatus } from "@repo/db";

/**
 * The V1 workflow (ADR-0001): a fixed sequence of agent steps. A step can run
 * once every artifact its agent takes as input has an approved version.
 */
export interface WorkflowStep {
  role: AgentRole;
  produces: ArtifactType;
  requires: readonly ArtifactType[];
}

const sequence: AgentRole[] = ["pm", "designer"];

export const workflowSteps: WorkflowStep[] = sequence.map((role) => ({
  role,
  produces: agents[role].produces,
  requires: agents[role].inputs,
}));

/** What the state computation needs to know about a project. */
export interface ProjectSnapshot {
  artifacts: Partial<Record<ArtifactType, ArtifactSnapshot>>;
  /** Roles with a run currently in progress. */
  activeRoles: AgentRole[];
}

export interface ArtifactSnapshot {
  latest: {
    id: string;
    version: number;
    status: ArtifactVersionStatus;
    /** Reviewer feedback, when the latest version was rejected. */
    feedback: string | null;
  };
  hasApproved: boolean;
}

export type StepState =
  | { status: "blocked"; waitingOn: ArtifactType[] }
  | { status: "ready" }
  | { status: "running" }
  | { status: "awaiting_approval"; versionId: string }
  | { status: "needs_revision"; versionId: string; feedback: string }
  | { status: "approved"; versionId: string };

export type NextAction =
  | {
      type: "run";
      role: AgentRole;
      revision?: { versionId: string; feedback: string };
    }
  | { type: "review"; versionId: string }
  | { type: "wait" }
  | { type: "complete" };

export interface WorkflowState {
  steps: (WorkflowStep & { state: StepState })[];
  next: NextAction;
}

export function computeWorkflowState(snapshot: ProjectSnapshot): WorkflowState {
  const steps = workflowSteps.map((step) => ({
    ...step,
    state: computeStepState(step, snapshot),
  }));
  return { steps, next: computeNextAction(steps) };
}

function computeStepState(
  step: WorkflowStep,
  snapshot: ProjectSnapshot,
): StepState {
  const waitingOn = step.requires.filter(
    (type) => !snapshot.artifacts[type]?.hasApproved,
  );
  if (waitingOn.length > 0) return { status: "blocked", waitingOn };
  if (snapshot.activeRoles.includes(step.role)) return { status: "running" };

  const latest = snapshot.artifacts[step.produces]?.latest;
  if (!latest) return { status: "ready" };
  switch (latest.status) {
    case "pending_approval":
      return { status: "awaiting_approval", versionId: latest.id };
    case "approved":
      return { status: "approved", versionId: latest.id };
    case "rejected":
      return {
        status: "needs_revision",
        versionId: latest.id,
        feedback: latest.feedback ?? "",
      };
    // Not produced in V1: agents write versions as pending_approval, and only
    // older approved versions become superseded.
    case "draft":
    case "superseded":
      return { status: "ready" };
  }
}

function computeNextAction(steps: WorkflowState["steps"]): NextAction {
  for (const step of steps) {
    switch (step.state.status) {
      case "approved":
        continue;
      case "ready":
        return { type: "run", role: step.role };
      case "needs_revision":
        return {
          type: "run",
          role: step.role,
          revision: {
            versionId: step.state.versionId,
            feedback: step.state.feedback,
          },
        };
      case "awaiting_approval":
        return { type: "review", versionId: step.state.versionId };
      case "running":
      case "blocked":
        return { type: "wait" };
    }
  }
  return { type: "complete" };
}
