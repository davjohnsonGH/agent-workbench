import { executePmRun, ModelRefusalError } from "@repo/agents";
import {
  agentRun,
  artifactVersionInput,
  createDb,
  type Db,
  project,
} from "@repo/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sampleRequirements } from "../fixtures/artifacts";
import { FakeProvider } from "../fixtures/fake-provider";

// Requires a migrated Postgres (`npm run db:up && npm run db:migrate`).
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("executePmRun", () => {
  let db: Db;

  beforeAll(() => {
    db = createDb(url!);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  async function createProject() {
    const [row] = await db
      .insert(project)
      .values({ name: "Meal planner", idea: "Plan weekly dinners" })
      .returning();
    return row!;
  }

  it("stores requirements as version 1 awaiting approval", async () => {
    const proj = await createProject();
    const provider = new FakeProvider(() => sampleRequirements);

    const { run, version } = await executePmRun(db, provider, {
      projectId: proj.id,
    });

    expect(run).toMatchObject({
      status: "succeeded",
      role: "pm",
      model: "fake-model",
      inputTokens: 100,
      outputTokens: 200,
    });
    expect(run.finishedAt).not.toBeNull();
    expect(version).toMatchObject({
      version: 1,
      status: "pending_approval",
      producedByRunId: run.id,
      content: sampleRequirements,
    });
    expect(provider.requests[0]?.prompt).toContain("Plan weekly dinners");
  });

  it("creates a new version linked to the previous one when revising", async () => {
    const proj = await createProject();
    const provider = new FakeProvider(() => sampleRequirements);
    const first = await executePmRun(db, provider, { projectId: proj.id });

    const second = await executePmRun(db, provider, {
      projectId: proj.id,
      revision: { versionId: first.version.id, feedback: "Add lunches" },
    });

    expect(second.version.version).toBe(2);
    expect(second.version.artifactId).toBe(first.version.artifactId);
    expect(provider.requests[1]?.prompt).toContain("Add lunches");
    const lineage = await db
      .select()
      .from(artifactVersionInput)
      .where(eq(artifactVersionInput.artifactVersionId, second.version.id));
    expect(lineage).toEqual([
      {
        artifactVersionId: second.version.id,
        inputVersionId: first.version.id,
      },
    ]);
  });

  it("records a failed run and rethrows when the model fails", async () => {
    const proj = await createProject();
    const provider = new FakeProvider(() => {
      throw new ModelRefusalError("cyber", {
        inputTokens: 10,
        outputTokens: 0,
      });
    });

    await expect(
      executePmRun(db, provider, { projectId: proj.id }),
    ).rejects.toBeInstanceOf(ModelRefusalError);

    const runs = await db
      .select()
      .from(agentRun)
      .where(eq(agentRun.projectId, proj.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: "failed",
      error: "Model refused the request (cyber)",
      inputTokens: 10,
    });
  });
});
