import { decideVersion } from "@repo/workflow";
import { z } from "zod";

import { getDb, handle, parseId } from "@/lib/server";

const body = z.object({
  decision: z.enum(["approved", "rejected"]),
  feedback: z.string().max(10_000).optional(),
});

/** Approve or reject (with feedback) a version awaiting approval. */
export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;
    const input = body.parse(await request.json());
    return decideVersion(getDb(), parseId(id), input);
  });
}
