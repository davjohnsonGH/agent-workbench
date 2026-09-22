import {
  type ArtifactContent,
  artifactRegistry,
  type ArtifactType,
} from "@repo/artifacts";
import type { AgentRole } from "@repo/db";

import type { StructuredRequest } from "./model";

/** Approved upstream artifacts an agent receives, keyed by type. */
export type AgentInputs = Partial<ArtifactContent>;

export interface AgentContext<T extends ArtifactType> {
  idea: string;
  inputs: AgentInputs;
  /** Present when revising a rejected version. */
  revision?: { previous: ArtifactContent[T]; feedback: string };
}

/**
 * A role on the team: what it produces, which approved artifacts it needs,
 * and how it prompts the model. Run recording, versioning, and lineage are
 * shared (see `executeAgentRun`).
 */
export interface AgentDefinition<T extends ArtifactType = ArtifactType> {
  role: AgentRole;
  produces: T;
  /** Artifact types that must have an approved version before this agent runs. */
  inputs: readonly ArtifactType[];
  system: string;
  buildPrompt(context: AgentContext<T>): string;
  /**
   * Problems the schema cannot catch, such as references to upstream
   * artifacts. Any problem fails the run.
   */
  check?(output: ArtifactContent[T], inputs: AgentInputs): string[];
}

/** The model request an agent makes for a given context. */
export function buildAgentRequest<T extends ArtifactType>(
  agent: AgentDefinition<T>,
  context: AgentContext<T>,
): StructuredRequest<(typeof artifactRegistry)[T]["schema"]> {
  return {
    system: agent.system,
    prompt: agent.buildPrompt(context),
    schema: artifactRegistry[agent.produces].schema,
  };
}

/** Prompt section for revising a rejected version with reviewer feedback. */
export function revisionPrompt(
  tag: string,
  revision: { previous: unknown; feedback: string },
): string {
  return `<previous_${tag}>
${JSON.stringify(revision.previous, null, 2)}
</previous_${tag}>

<reviewer_feedback>
${revision.feedback}
</reviewer_feedback>

The reviewer rejected the previous version. Revise it to address the feedback. Keep the ids of items that still apply so existing references remain valid.`;
}
