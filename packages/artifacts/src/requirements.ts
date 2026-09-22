import { z } from "zod";

/**
 * Requirements document produced by the PM agent.
 *
 * Schemas are also sent to the model as structured-output JSON Schema, so keep
 * constraints to what JSON Schema expresses simply (required fields, enums,
 * `min(1)` on arrays) and put guidance in `.describe()`.
 */

export const priorities = ["must", "should", "could"] as const;
export type Priority = (typeof priorities)[number];

export const userStorySchema = z.object({
  id: z
    .string()
    .min(1)
    .describe('Stable identifier referenced by later artifacts, e.g. "US-1".'),
  asA: z.string().min(1).describe("The user role."),
  iWant: z.string().min(1).describe("The capability the user wants."),
  soThat: z.string().min(1).describe("The benefit to the user."),
  acceptanceCriteria: z
    .array(z.string().min(1))
    .min(1)
    .describe("Concrete, testable conditions for the story to be done."),
  priority: z.enum(priorities),
});
export type UserStory = z.infer<typeof userStorySchema>;

export const requirementsSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe("The problem being solved and for whom, in a short paragraph."),
  goals: z.array(z.string().min(1)).min(1),
  nonGoals: z
    .array(z.string().min(1))
    .describe("Explicitly out of scope, to prevent scope creep."),
  targetUsers: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .min(1),
  userStories: z.array(userStorySchema).min(1),
  constraints: z
    .array(z.string().min(1))
    .describe("Technical, business, or regulatory constraints."),
  openQuestions: z
    .array(z.string().min(1))
    .describe("Unresolved questions for the human reviewer."),
});
export type Requirements = z.infer<typeof requirementsSchema>;
