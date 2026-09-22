import {
  executeAgentRun,
  ModelOutputError,
  ModelRefusalError,
} from "@repo/agents";
import {
  agentRun,
  artifactVersion,
  artifactVersionInput,
  createDb,
  type Db,
  project,
} from "@repo/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sampleDesignSpec, sampleRequirements } from "../fixtures/artifacts";
import { FakeProvider, sampleTeamProvider } from "../fixtures/fake-provider";

// Requires Postgres; tests use an isolated database (see vitest.config.ts).
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("executeAgentRun", () => {
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

  async function lineageOf(versionId: string) {
    const rows = await db
      .select({ id: artifactVersionInput.inputVersionId })
      .from(artifactVersionInput)
      .where(eq(artifactVersionInput.artifactVersionId, versionId));
    return rows.map((r) => r.id).sort();
  }

  /** A project whose requirements v1 is approved. */
  async function projectWithApprovedRequirements() {
    const proj = await createProject();
    const { version } = await executeAgentRun(db, sampleTeamProvider(), {
      projectId: proj.id,
      role: "pm",
    });
    await db
      .update(artifactVersion)
      .set({ status: "approved" })
      .where(eq(artifactVersion.id, version.id));
    return { proj, requirements: version };
  }

  it("stores PM output as requirements v1 awaiting approval", async () => {
    const proj = await createProject();
    const provider = new FakeProvider(() => sampleRequirements);

    const { run, version } = await executeAgentRun(db, provider, {
      projectId: proj.id,
      role: "pm",
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
    expect(await lineageOf(version.id)).toEqual([]);
  });

  it("links a revision to the version it revises", async () => {
    const proj = await createProject();
    const provider = new FakeProvider(() => sampleRequirements);
    const first = await executeAgentRun(db, provider, {
      projectId: proj.id,
      role: "pm",
    });

    const second = await executeAgentRun(db, provider, {
      projectId: proj.id,
      role: "pm",
      revision: { versionId: first.version.id, feedback: "Add lunches" },
    });

    expect(second.version.version).toBe(2);
    expect(second.version.artifactId).toBe(first.version.artifactId);
    expect(provider.requests[1]?.prompt).toContain("Add lunches");
    expect(await lineageOf(second.version.id)).toEqual([first.version.id]);
  });

  it("gives the designer the approved requirements and records them as lineage", async () => {
    const { proj, requirements } = await projectWithApprovedRequirements();
    const provider = sampleTeamProvider();

    const { run, version } = await executeAgentRun(db, provider, {
      projectId: proj.id,
      role: "designer",
    });

    expect(run).toMatchObject({ status: "succeeded", role: "designer" });
    expect(run.input).toMatchObject({ inputVersionIds: [requirements.id] });
    expect(version).toMatchObject({
      version: 1,
      status: "pending_approval",
      content: sampleDesignSpec,
    });
    expect(provider.requests[0]?.prompt).toContain("<approved_requirements>");
    expect(await lineageOf(version.id)).toEqual([requirements.id]);
  });

  it("fails the designer run without approved requirements", async () => {
    const proj = await createProject();
    await expect(
      executeAgentRun(db, sampleTeamProvider(), {
        projectId: proj.id,
        role: "designer",
      }),
    ).rejects.toThrow("No approved requirements");
  });

  it("fails the run when the spec references unknown stories", async () => {
    const { proj } = await projectWithApprovedRequirements();
    const provider = sampleTeamProvider({
      designSpec: {
        ...sampleDesignSpec,
        screens: [
          { ...sampleDesignSpec.screens[0]!, userStoryIds: ["US-404"] },
        ],
      },
    });

    await expect(
      executeAgentRun(db, provider, { projectId: proj.id, role: "designer" }),
    ).rejects.toBeInstanceOf(ModelOutputError);

    const [run] = await db
      .select()
      .from(agentRun)
      .where(eq(agentRun.projectId, proj.id))
      .orderBy(agentRun.createdAt)
      .offset(1);
    expect(run).toMatchObject({
      role: "designer",
      status: "failed",
      error: "References unknown user stories: US-404",
      inputTokens: 100,
    });
  });

  it("records a failed run and rethrows when the model refuses", async () => {
    const proj = await createProject();
    const provider = new FakeProvider(() => {
      throw new ModelRefusalError("cyber", {
        inputTokens: 10,
        outputTokens: 0,
      });
    });

    await expect(
      executeAgentRun(db, provider, { projectId: proj.id, role: "pm" }),
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
