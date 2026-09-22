import { agentRun, createDb, type Db, project } from "@repo/db";
import { eq } from "drizzle-orm";
import {
  createProject,
  decideVersion,
  getProjectDetail,
  getWorkflowState,
  listProjects,
  WorkflowError,
} from "@repo/workflow";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { sampleRequirements } from "../fixtures/artifacts";
import { FakeProvider, sampleTeamProvider } from "../fixtures/fake-provider";
import { runNextStepNow, testQueue } from "../fixtures/workflow";

// Requires Postgres; tests use an isolated database (see vitest.config.ts).
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("workflow service", () => {
  let db: Db;
  // A fresh queue per test, so a job one test leaves behind is never
  // processed by another.
  let queue: string;

  beforeAll(() => {
    db = createDb(url!);
  });

  beforeEach(() => {
    queue = testQueue();
  });

  afterAll(async () => {
    await db.$client.end();
  });

  function newProject() {
    return createProject(db, { name: "Meal planner", idea: "Plan dinners" });
  }

  it("runs PM then designer to completion, looping on rejection", async () => {
    const proj = await newProject();
    const provider = sampleTeamProvider();

    // PM drafts version 1.
    const first = await runNextStepNow(db, provider, proj.id, queue);
    expect((await getWorkflowState(db, proj.id)).next).toEqual({
      type: "review",
      versionId: first.version.id,
    });

    // Reviewer rejects; the next run revises with that feedback.
    await decideVersion(db, first.version.id, {
      decision: "rejected",
      feedback: "Cut scope to dinners only",
    });
    const second = await runNextStepNow(db, provider, proj.id, queue);
    expect(second.version.version).toBe(2);
    expect(provider.requests[1]?.prompt).toContain("Cut scope to dinners only");

    // Reviewer approves version 2; the designer is next.
    await decideVersion(db, second.version.id, { decision: "approved" });
    const state = await getWorkflowState(db, proj.id);
    expect(state.steps[0]?.state).toEqual({
      status: "approved",
      versionId: second.version.id,
    });
    expect(state.next).toEqual({ type: "run", role: "designer" });

    // Designer drafts the spec from the approved requirements; approving it
    // completes the workflow.
    const design = await runNextStepNow(db, provider, proj.id, queue);
    expect(design.run.role).toBe("designer");
    expect(provider.requests[2]?.prompt).toContain("<approved_requirements>");
    await decideVersion(db, design.version.id, { decision: "approved" });
    expect((await getWorkflowState(db, proj.id)).next).toEqual({
      type: "complete",
    });

    const detail = await getProjectDetail(db, proj.id);
    expect(detail.versions.map((v) => [v.type, v.version, v.status])).toEqual([
      ["design_spec", 1, "approved"],
      ["requirements", 2, "approved"],
      ["requirements", 1, "rejected"],
    ]);
    expect(detail.versions[2]?.decisions[0]?.feedback).toBe(
      "Cut scope to dinners only",
    );
    expect(detail.runs).toHaveLength(3);
  });

  it("lists projects newest first", async () => {
    const older = await newProject();
    const newer = await newProject();
    const ids = (await listProjects(db)).map((p) => p.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
  });

  it("deletes a project with runs and revisions", async () => {
    const proj = await newProject();
    const provider = new FakeProvider(() => sampleRequirements);
    const first = await runNextStepNow(db, provider, proj.id, queue);
    await decideVersion(db, first.version.id, {
      decision: "rejected",
      feedback: "Revise",
    });
    await runNextStepNow(db, provider, proj.id, queue);

    await db.delete(project).where(eq(project.id, proj.id));

    const runs = await db
      .select()
      .from(agentRun)
      .where(eq(agentRun.projectId, proj.id));
    expect(runs).toEqual([]);
  });

  it("requires feedback to reject", async () => {
    const proj = await newProject();
    const { version } = await runNextStepNow(
      db,
      new FakeProvider(() => sampleRequirements),
      proj.id,
      queue,
    );

    await expect(
      decideVersion(db, version.id, { decision: "rejected", feedback: "  " }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("refuses to decide a version twice", async () => {
    const proj = await newProject();
    const { version } = await runNextStepNow(
      db,
      new FakeProvider(() => sampleRequirements),
      proj.id,
      queue,
    );
    await decideVersion(db, version.id, { decision: "approved" });

    await expect(
      decideVersion(db, version.id, { decision: "approved" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses to run while a version awaits review", async () => {
    const proj = await newProject();
    const provider = new FakeProvider(() => sampleRequirements);
    await runNextStepNow(db, provider, proj.id, queue);

    await expect(
      runNextStepNow(db, provider, proj.id, queue),
    ).rejects.toMatchObject({
      code: "conflict",
    });
    expect(provider.requests).toHaveLength(1);
  });

  it("reports unknown projects and versions as not found", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    await expect(getWorkflowState(db, missing)).rejects.toBeInstanceOf(
      WorkflowError,
    );
    await expect(
      decideVersion(db, missing, { decision: "approved" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
