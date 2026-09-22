import { createProject } from "@repo/workflow";
import { z } from "zod";

import { getDb, handle } from "@/lib/server";

const body = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  idea: z.string().trim().min(1).max(10_000),
});

export function POST(request: Request) {
  return handle(async () => {
    const input = body.parse(await request.json());
    return createProject(getDb(), {
      idea: input.idea,
      name: input.name ?? input.idea.slice(0, 80),
    });
  });
}
