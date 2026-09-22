import "server-only";

import { createDb, type Db } from "@repo/db";
import { WorkflowError } from "@repo/workflow";
import { z } from "zod";

// Reuse one connection pool across hot reloads in development.
const globalForServer = globalThis as unknown as { db?: Db };

export function getDb(): Db {
  if (!globalForServer.db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForServer.db = createDb(url);
  }
  return globalForServer.db;
}

const statusByCode = {
  invalid: 400,
  not_found: 404,
  conflict: 409,
} as const;

/** Run a route handler body, mapping known errors to JSON error responses. */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid request", issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof WorkflowError) {
      return Response.json(
        { error: error.message },
        { status: statusByCode[error.code] },
      );
    }
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Parse a route id param; non-UUIDs are reported as not found. */
export function parseId(id: string): string {
  if (!z.uuid().safeParse(id).success) {
    throw new WorkflowError("not_found", "Not found");
  }
  return id;
}
