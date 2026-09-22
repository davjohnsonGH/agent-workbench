import { designerAgent, generateArtifact, pmAgent } from "@repo/agents";
import { designSpecSchema, requirementsSchema } from "@repo/artifacts";
import { describe, expect, it } from "vitest";

import { sampleDesignSpec, sampleRequirements } from "../fixtures/artifacts";
import { sampleTeamProvider } from "../fixtures/fake-provider";

describe("pmAgent", () => {
  it("prompts with the idea", () => {
    const prompt = pmAgent.buildPrompt({ idea: "A meal planner", inputs: {} });
    expect(prompt).toContain("<idea>\nA meal planner\n</idea>");
    expect(prompt).not.toContain("reviewer_feedback");
  });

  it("includes previous requirements and feedback when revising", () => {
    const prompt = pmAgent.buildPrompt({
      idea: "A meal planner",
      inputs: {},
      revision: { previous: sampleRequirements, feedback: "Add lunches" },
    });
    expect(prompt).toContain(
      "<reviewer_feedback>\nAdd lunches\n</reviewer_feedback>",
    );
    expect(prompt).toContain("<previous_requirements>");
    expect(prompt).toContain('"id": "US-1"');
  });
});

describe("designerAgent", () => {
  const inputs = { requirements: sampleRequirements };

  it("prompts with the approved requirements", () => {
    const prompt = designerAgent.buildPrompt({
      idea: "A meal planner",
      inputs,
    });
    expect(prompt).toContain("<approved_requirements>");
    expect(prompt).toContain('"id": "US-2"');
  });

  it("includes the previous spec and feedback when revising", () => {
    const prompt = designerAgent.buildPrompt({
      idea: "A meal planner",
      inputs,
      revision: { previous: sampleDesignSpec, feedback: "Fewer screens" },
    });
    expect(prompt).toContain("<previous_design_spec>");
    expect(prompt).toContain("Fewer screens");
  });

  it("accepts a spec that references existing stories", () => {
    expect(designerAgent.check!(sampleDesignSpec, inputs)).toEqual([]);
  });

  it("flags references to stories that do not exist", () => {
    const spec = {
      ...sampleDesignSpec,
      userFlows: [
        { ...sampleDesignSpec.userFlows[0]!, userStoryIds: ["US-9"] },
      ],
    };
    expect(designerAgent.check!(spec, inputs)).toEqual([
      "References unknown user stories: US-9",
    ]);
  });
});

describe("generateArtifact", () => {
  it("requests output matching the agent's artifact schema", async () => {
    const provider = sampleTeamProvider();
    await generateArtifact(provider, pmAgent, { idea: "x", inputs: {} });
    await generateArtifact(provider, designerAgent, {
      idea: "x",
      inputs: { requirements: sampleRequirements },
    });

    expect(provider.requests.map((r) => r.schema)).toEqual([
      requirementsSchema,
      designSpecSchema,
    ]);
    expect(provider.requests.map((r) => r.system)).toEqual([
      pmAgent.system,
      designerAgent.system,
    ]);
  });
});
