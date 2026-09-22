import { ModelOutputError, ModelRefusalError } from "@repo/agents";
import { agentRun, createDb, type Db, job, modelCall } from "@repo/db";
import {
  createProject,
  enqueueNextStep,
  getWorkflowState,
  WorkflowError,
} from "@repo/workflow";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { sampleRequirements } from "../fixtures/artifacts";
import { FakeProvider } from "../fixtures/fake-provider";
import { processOne, testQueue } from "../fixtures/workflow";

// Requires Postgres; tests use an isolated database (see vitest.config.ts).
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("agent runs through the queue", () => {
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

  const newProject = () =>
    createProject(db, { name: "Meal planner", idea: "Plan dinners" });

  async function runsOf(projectId: string) {
    return db.select().from(agentRun).where(eq(agentRun.projectId, projectId));
  }

  async function callsOf(runId: string) {
    return db.select().from(modelCall).where(eq(modelCall.runId, runId));
  }

  it("queues a run and a job atomically, then the worker executes it", async () => {
    const proj = await newProject();
    const run = await enqueueNextStep(db, proj.id, { queue });

    expect(run).toMatchObject({ status: "queued", role: "pm" });
    expect((await getWorkflowState(db, proj.id)).steps[0]?.state).toEqual({
      status: "queued",
    });
    const [queued] = await db
      .select()
      .from(job)
      .where(sql`${job.payload}->>'runId' = ${run.id}`);
    expect(queued).toMatchObject({
      queue,
      type: "agent_run",
      status: "queued",
    });

    const result = await processOne(
      db,
      new FakeProvider(() => sampleRequirements),
      queue,
    );

    expect(result.outcome).toBe("succeeded");
    expect((await runsOf(proj.id))[0]?.status).toBe("succeeded");
    expect((await getWorkflowState(db, proj.id)).next.type).toBe("review");
  });

  it("lets only one of two concurrent requests queue a run", async () => {
    const proj = await newProject();

    const results = await Promise.allSettled([
      enqueueNextStep(db, proj.id, { queue }),
      enqueueNextStep(db, proj.id, { queue }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(WorkflowError);
    expect(rejected?.reason).toMatchObject({ code: "conflict" });
    expect(await runsOf(proj.id)).toHaveLength(1);
  });

  it("retries bad output and succeeds on the next attempt", async () => {
    const proj = await newProject();
    let calls = 0;
    const provider = new FakeProvider(() => {
      calls += 1;
      if (calls === 1) {
        throw new ModelOutputError("Model output was truncated", {
          inputTokens: 10,
          outputTokens: 5,
        });
      }
      return sampleRequirements;
    });
    const run = await enqueueNextStep(db, proj.id, { queue });

    expect((await processOne(db, provider, queue)).outcome).toBe("retrying");
    expect((await runsOf(proj.id))[0]).toMatchObject({
      status: "queued",
      error: "Model output was truncated",
    });

    expect((await processOne(db, provider, queue)).outcome).toBe("succeeded");
    const [finished] = await runsOf(proj.id);
    expect(finished).toMatchObject({
      status: "succeeded",
      error: null,
      // Summed over both model calls.
      inputTokens: 110,
      outputTokens: 205,
    });
    const traced = await callsOf(run.id);
    expect(traced.map((c) => c.error).sort()).toEqual([
      "Model output was truncated",
      null,
    ]);
  });

  it("fails a refused run without retrying, and allows running again", async () => {
    const proj = await newProject();
    const provider = new FakeProvider(() => {
      throw new ModelRefusalError("cyber");
    });
    await enqueueNextStep(db, proj.id, { queue });

    expect((await processOne(db, provider, queue)).outcome).toBe("failed");
    expect((await runsOf(proj.id))[0]).toMatchObject({
      status: "failed",
      error: "Model refused the request (cyber)",
    });
    expect((await getWorkflowState(db, proj.id)).next).toEqual({
      type: "run",
      role: "pm",
    });
    await expect(
      enqueueNextStep(db, proj.id, { queue }),
    ).resolves.toMatchObject({ status: "queued" });
  });

  it("does not call the model again when a finished run's job is re-delivered", async () => {
    const proj = await newProject();
    const provider = new FakeProvider(() => sampleRequirements);
    const run = await enqueueNextStep(db, proj.id, { queue });
    await processOne(db, provider, queue);

    // Simulate a worker that committed the run but crashed before marking
    // the job done: the job is delivered again.
    await db
      .update(job)
      .set({ status: "queued", runAt: new Date(0) })
      .where(sql`${job.payload}->>'runId' = ${run.id}`);

    expect((await processOne(db, provider, queue)).outcome).toBe("succeeded");
    expect(provider.requests).toHaveLength(1);
    expect(await callsOf(run.id)).toHaveLength(1);
  });
});
