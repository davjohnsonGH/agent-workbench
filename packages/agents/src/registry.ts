import type { AgentRole } from "@repo/db";

import type { AgentDefinition } from "./definition";
import { designerAgent } from "./designer-agent";
import { pmAgent } from "./pm-agent";

export const agents: Record<AgentRole, AgentDefinition> = {
  pm: pmAgent,
  designer: designerAgent,
};
