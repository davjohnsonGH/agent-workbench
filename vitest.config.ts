import { defineConfig } from "vitest/config";

// Load the repo-root .env (e.g. DATABASE_URL for integration tests) when
// present; CI sets variables directly.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file.
}

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
