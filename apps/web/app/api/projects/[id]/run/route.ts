import { enqueueNextStep } from "@repo/workflow";

import { getDb, handle, parseId } from "@/lib/server";

/**
 * Queue the agent for the project's next workflow step. Returns the queued
 * run immediately; the worker executes it (ADR-0005).
 */
export function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;
    return enqueueNextStep(getDb(), parseId(id));
  });
}
