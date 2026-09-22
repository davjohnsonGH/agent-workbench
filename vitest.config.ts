import { defineConfig } from "vitest/config";

// Load the repo-root .env when present; CI sets variables directly.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file.
}

// Integration tests use a separate database: TEST_DATABASE_URL, or
// DATABASE_URL with "_test" appended to the database name. It is created and
// migrated by tests/setup/test-database.ts.
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? toTestUrl(process.env.DATABASE_URL);
if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;

function toTestUrl(url: string | undefined) {
  if (!url) return undefined;
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname}_test`;
  return parsed.toString();
}

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/test-database.ts"],
  },
});
