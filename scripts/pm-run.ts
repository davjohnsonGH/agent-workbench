/**
 * Run the PM agent against the real model for a new project and print the
 * resulting requirements.
 *
 *   npm run agent:pm -- "A meal planner for busy families"
 *
 * Needs a migrated database and Anthropic credentials (ANTHROPIC_API_KEY) in
 * .env. Set AGENT_MODEL to override the default model, and
 * ANTHROPIC_WORKSPACE_ID if the API key is not scoped to a workspace.
 */
import { AnthropicProvider, runAgent } from "@repo/agents";
import { createDb, project } from "@repo/db";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file.
}

const idea = process.argv.slice(2).join(" ").trim();
if (!idea) {
  console.error('Usage: npm run agent:pm -- "<product idea>"');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.");
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL);
const provider = new AnthropicProvider({
  model: process.env.AGENT_MODEL,
  workspaceId: process.env.ANTHROPIC_WORKSPACE_ID,
});

try {
  const [proj] = await db
    .insert(project)
    .values({ name: idea.slice(0, 80), idea })
    .returning();
  console.error(
    `Project ${proj!.id}: running PM agent on ${provider.model}...`,
  );

  const { run, version } = await runAgent(db, provider, {
    projectId: proj!.id,
    role: "pm",
  });
  const seconds = (run.finishedAt!.getTime() - run.startedAt!.getTime()) / 1000;
  console.error(
    `Run ${run.id}: ${run.status} on ${run.model} in ${seconds.toFixed(1)}s ` +
      `(${run.inputTokens} in / ${run.outputTokens} out tokens)`,
  );
  console.log(JSON.stringify(version.content, null, 2));
} finally {
  await db.$client.end();
}
