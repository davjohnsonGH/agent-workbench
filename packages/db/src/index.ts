import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export * from "./schema";

export function createDb(url: string) {
  const client = postgres(url);
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

/** A transaction handle, usable anywhere a `Db` is for queries. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
