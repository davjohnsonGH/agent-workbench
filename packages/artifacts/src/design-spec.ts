import { z } from "zod";

import type { Requirements } from "./requirements";

/** Design specification produced by the Designer agent from approved requirements. */

const userStoryIds = z
  .array(z.string().min(1))
  .min(1)
  .describe("Ids of the requirements user stories this addresses.");

export const designSpecSchema = z.object({
  overview: z
    .string()
    .min(1)
    .describe("The overall experience and design approach."),
  screens: z
    .array(
      z.object({
        id: z.string().min(1).describe('Stable identifier, e.g. "SCR-1".'),
        name: z.string().min(1),
        purpose: z.string().min(1),
        keyElements: z
          .array(z.string().min(1))
          .min(1)
          .describe("Main UI elements and the information they show."),
        userStoryIds,
      }),
    )
    .min(1),
  userFlows: z
    .array(
      z.object({
        id: z.string().min(1).describe('Stable identifier, e.g. "FLOW-1".'),
        name: z.string().min(1),
        steps: z.array(z.string().min(1)).min(1),
        userStoryIds,
      }),
    )
    .min(1),
  designDecisions: z.array(
    z.object({
      decision: z.string().min(1),
      rationale: z.string().min(1),
    }),
  ),
  openQuestions: z.array(z.string().min(1)),
});
export type DesignSpec = z.infer<typeof designSpecSchema>;

/**
 * Story ids referenced by the spec that do not exist in the requirements it
 * was derived from. The schema cannot check this on its own.
 */
export function findUnknownStoryRefs(
  spec: DesignSpec,
  requirements: Requirements,
): string[] {
  const known = new Set(requirements.userStories.map((s) => s.id));
  const referenced = [...spec.screens, ...spec.userFlows].flatMap(
    (item) => item.userStoryIds,
  );
  return [...new Set(referenced)].filter((id) => !known.has(id));
}
