import { type Requirements, requirementsSchema } from "@repo/artifacts";

import type { ModelProvider, StructuredResponse } from "./model";

export const PM_SYSTEM_PROMPT = `You are the product manager on a small software team. You turn a product or feature idea into a requirements document that a designer and engineers will build from, after a human reviewer approves it.

Write requirements that are specific to this idea and testable: each user story needs acceptance criteria an engineer could verify. Give stories stable ids ("US-1", "US-2", ...), since later design and engineering artifacts reference them. Scope the document to what the idea supports; where the idea is ambiguous, record the ambiguity as an open question for the reviewer rather than inventing an answer.`;

export interface PmInput {
  idea: string;
  /** Present when revising a rejected version. */
  revision?: {
    previous: Requirements;
    feedback: string;
  };
}

export function buildPmPrompt(input: PmInput): string {
  const idea = `<idea>\n${input.idea}\n</idea>`;
  if (!input.revision) {
    return `${idea}\n\nWrite the requirements document for this idea.`;
  }
  return `${idea}

<previous_requirements>
${JSON.stringify(input.revision.previous, null, 2)}
</previous_requirements>

<reviewer_feedback>
${input.revision.feedback}
</reviewer_feedback>

The reviewer rejected the previous requirements. Revise them to address the feedback. Keep the ids of stories that still apply so existing references remain valid.`;
}

export function generateRequirements(
  provider: ModelProvider,
  input: PmInput,
): Promise<StructuredResponse<Requirements>> {
  return provider.generateStructured({
    system: PM_SYSTEM_PROMPT,
    prompt: buildPmPrompt(input),
    schema: requirementsSchema,
  });
}
