import { defineConfig } from "drizzle-kit";

// Load the repo-root .env when present; CI and deployed environments set the
// variable directly.
try {
  process.loadEnvFile("../../.env");
} catch {
  // No .env file.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
});
