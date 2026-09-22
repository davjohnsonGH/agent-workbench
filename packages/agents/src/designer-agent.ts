import { findUnknownStoryRefs } from "@repo/artifacts";

import { type AgentDefinition, revisionPrompt } from "./definition";

export const designerAgent: AgentDefinition<"design_spec"> = {
  role: "designer",
  produces: "design_spec",
  inputs: ["requirements"],
  system: `You are the product designer on a small software team. From approved requirements, you write a design specification (screens, user flows, and the reasoning behind key design decisions) that engineers will build from, after a human reviewer approves it.

Design for the requirements as approved: every "must" user story should be addressed by at least one screen or flow, and each screen and flow lists the ids of the stories it addresses. Only reference story ids that exist in the requirements. Do not add features the requirements do not call for. Where the requirements leave a design question open, record it as an open question rather than inventing an answer.`,

  buildPrompt({ idea, inputs, revision }) {
    const context = `<idea>\n${idea}\n</idea>

<approved_requirements>
${JSON.stringify(inputs.requirements, null, 2)}
</approved_requirements>`;
    return revision
      ? `${context}\n\n${revisionPrompt("design_spec", revision)}`
      : `${context}\n\nWrite the design specification for these requirements.`;
  },

  check(spec, inputs) {
    if (!inputs.requirements) return ["Approved requirements are missing"];
    const unknown = findUnknownStoryRefs(spec, inputs.requirements);
    return unknown.length > 0
      ? [`References unknown user stories: ${unknown.join(", ")}`]
      : [];
  },
};
