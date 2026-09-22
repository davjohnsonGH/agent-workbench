import {
  buildPmPrompt,
  generateRequirements,
  PM_SYSTEM_PROMPT,
} from "@repo/agents";
import { requirementsSchema } from "@repo/artifacts";
import { describe, expect, it } from "vitest";

import { sampleRequirements } from "../fixtures/artifacts";
import { FakeProvider } from "../fixtures/fake-provider";

describe("buildPmPrompt", () => {
  it("includes the idea", () => {
    const prompt = buildPmPrompt({ idea: "A meal planner" });
    expect(prompt).toContain("<idea>\nA meal planner\n</idea>");
    expect(prompt).not.toContain("reviewer_feedback");
  });

  it("includes previous requirements and feedback when revising", () => {
    const prompt = buildPmPrompt({
      idea: "A meal planner",
      revision: { previous: sampleRequirements, feedback: "Add lunches" },
    });
    expect(prompt).toContain(
      "<reviewer_feedback>\nAdd lunches\n</reviewer_feedback>",
    );
    expect(prompt).toContain('"id": "US-1"');
  });
});

describe("generateRequirements", () => {
  it("asks the provider for requirements-shaped output", async () => {
    const provider = new FakeProvider(() => sampleRequirements);
    const result = await generateRequirements(provider, {
      idea: "A meal planner",
    });

    expect(result.output).toEqual(sampleRequirements);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.schema).toBe(requirementsSchema);
    expect(provider.requests[0]?.system).toBe(PM_SYSTEM_PROMPT);
  });
});
