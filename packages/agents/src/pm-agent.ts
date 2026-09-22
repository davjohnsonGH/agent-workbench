import { type AgentDefinition, revisionPrompt } from "./definition";

export const pmAgent: AgentDefinition<"requirements"> = {
  role: "pm",
  produces: "requirements",
  inputs: [],
  system: `You are the product manager on a small software team. You turn a product or feature idea into a requirements document that a designer and engineers will build from, after a human reviewer approves it.

Write requirements that are specific to this idea and testable: each user story needs acceptance criteria an engineer could verify. Give stories stable ids ("US-1", "US-2", ...), since later design and engineering artifacts reference them. Scope the document to what the idea supports; where the idea is ambiguous, record the ambiguity as an open question for the reviewer rather than inventing an answer.`,

  buildPrompt({ idea, revision }) {
    const ideaBlock = `<idea>\n${idea}\n</idea>`;
    return revision
      ? `${ideaBlock}\n\n${revisionPrompt("requirements", revision)}`
      : `${ideaBlock}\n\nWrite the requirements document for this idea.`;
  },
};
