import { findTaskListProblems } from "@repo/artifacts";

import { type AgentDefinition, revisionPrompt } from "./definition";

export const engineerAgent: AgentDefinition<"task_list"> = {
  role: "engineer",
  produces: "task_list",
  inputs: ["requirements", "design_spec"],
  system: `You are the tech lead on a small software team. From the approved requirements and design specification, you plan the engineering work as a list of tasks that engineers will pick up, after a human reviewer approves it.

Break the work into tasks small enough to estimate: S (under half a day), M (one to two days), or L (three to five days); split anything larger. Each task says which user stories and screens it delivers, which tasks must come first, and acceptance criteria an engineer can verify. Every "must" user story should be delivered by at least one task. Include enabling work (project setup, data model, shared components) only where the product work needs it, and do not plan features the requirements do not call for. Where a technical decision depends on something the requirements and design leave open, such as the platform or technology stack, record it as an open question or a risk rather than assuming an answer.`,

  buildPrompt({ idea, inputs, revision }) {
    const context = `<idea>\n${idea}\n</idea>

<approved_requirements>
${JSON.stringify(inputs.requirements, null, 2)}
</approved_requirements>

<approved_design_spec>
${JSON.stringify(inputs.design_spec, null, 2)}
</approved_design_spec>`;
    return revision
      ? `${context}\n\n${revisionPrompt("task_list", revision)}`
      : `${context}\n\nWrite the engineering task list for this design.`;
  },

  check(taskList, inputs) {
    if (!inputs.requirements || !inputs.design_spec) {
      return ["Approved requirements and design spec are required"];
    }
    return findTaskListProblems(
      taskList,
      inputs.requirements,
      inputs.design_spec,
    );
  },
};
