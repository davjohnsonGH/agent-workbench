/* global process */
// Load the repo-root .env (DATABASE_URL, Anthropic credentials); Next.js only
// reads .env files from apps/web. Deployed environments set variables directly.
try {
  process.loadEnvFile("../../.env");
} catch {
  // No .env file.
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages export TypeScript source.
  transpilePackages: [
    "@repo/agents",
    "@repo/artifacts",
    "@repo/db",
    "@repo/ui",
    "@repo/workflow",
  ],
};

export default nextConfig;
