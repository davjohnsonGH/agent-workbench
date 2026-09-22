import {
  buildAgentRequest,
  designerAgent,
  engineerAgent,
  pmAgent,
} from "@repo/agents";
import {
  designSpecSchema,
  requirementsSchema,
  taskListSchema,
} from "@repo/artifacts";
import { describe, expect, it } from "vitest";

import {
  sampleDesignSpec,
  sampleRequirements,
  sampleTaskList,
} from "../fixtures/artifacts";

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

describe("engineerAgent", () => {
  const inputs = {
    requirements: sampleRequirements,
    design_spec: sampleDesignSpec,
  };

  it("prompts with the approved requirements and design", () => {
    const prompt = engineerAgent.buildPrompt({
      idea: "A meal planner",
      inputs,
    });
    expect(prompt).toContain("<approved_requirements>");
    expect(prompt).toContain("<approved_design_spec>");
    expect(prompt).toContain('"id": "SCR-2"');
  });

  it("checks the task list against both inputs", () => {
    expect(engineerAgent.check!(sampleTaskList, inputs)).toEqual([]);
    const bad = {
      ...sampleTaskList,
      tasks: [{ ...sampleTaskList.tasks[0]!, screenIds: ["SCR-404"] }],
    };
    expect(engineerAgent.check!(bad, inputs)).toEqual([
      "References unknown screens: SCR-404",
    ]);
  });

  it("reports missing inputs instead of crashing", () => {
    expect(
      engineerAgent.check!(sampleTaskList, {
        requirements: sampleRequirements,
      }),
    ).toEqual(["Approved requirements and design spec are required"]);
  });
});

describe("buildAgentRequest", () => {
  it("uses the agent's prompt and artifact schema", () => {
    const pm = buildAgentRequest(pmAgent, { idea: "x", inputs: {} });
    const designer = buildAgentRequest(designerAgent, {
      idea: "x",
      inputs: { requirements: sampleRequirements },
    });

    expect(pm.schema).toBe(requirementsSchema);
    expect(pm.system).toBe(pmAgent.system);
    expect(designer.schema).toBe(designSpecSchema);
    expect(designer.prompt).toContain("<approved_requirements>");
    const engineer = buildAgentRequest(engineerAgent, {
      idea: "x",
      inputs: {
        requirements: sampleRequirements,
        design_spec: sampleDesignSpec,
      },
    });
    expect(engineer.schema).toBe(taskListSchema);
  });
});
