import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Vitest global setup: create the test database if it does not exist and
 * apply all migrations, so integration tests never touch the dev database.
 */
export default async function setup() {
  const url = process.env.DATABASE_URL;
  if (!url) return; // Integration tests skip themselves.

  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { onnotice: () => {} });
  try {
    const [exists] =
      await admin`select 1 from pg_database where datname = ${name}`;
    if (!exists) await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end();
  }

  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), {
      migrationsFolder: "packages/db/migrations",
    });
  } finally {
    await client.end();
  }
}
