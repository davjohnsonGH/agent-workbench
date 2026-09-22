import { runNextStep } from "@repo/workflow";

import { getDb, getProvider, handle, parseId } from "@/lib/server";

// Agent runs execute inside the request for now (ADR-0003) and can take a
// minute or more.
export const maxDuration = 300;

/** Run the agent for the project's next workflow step. */
export function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;
    return runNextStep(getDb(), getProvider(), parseId(id));
  });
}
