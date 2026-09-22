import { randomUUID } from "node:crypto";

import { createDb, type Db, job } from "@repo/db";
import {
  claimJob,
  completeJob,
  enqueue,
  failJob,
  heartbeat,
  type JobHandler,
  processNextJob,
} from "@repo/queue";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Requires Postgres; tests use an isolated database (see vitest.config.ts).
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("job queue", () => {
  let db: Db;

  beforeAll(() => {
    db = createDb(url!);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  /** A queue name unique to one test, so tests never claim each other's jobs. */
  const newQueue = () => `test-${randomUUID()}`;
  const lease = { workerId: "w1", leaseMs: 60_000 };

  async function reload(id: string) {
    const [row] = await db.select().from(job).where(eq(job.id, id));
    return row!;
  }

  it("claims a queued job once and completes it", async () => {
    const queue = newQueue();
    const queued = await enqueue(db, { queue, type: "t", payload: { n: 1 } });

    const claimed = await claimJob(db, { queue, ...lease });
    expect(claimed).toMatchObject({
      id: queued.id,
      status: "running",
      attempts: 1,
      lockedBy: "w1",
    });
    expect(await claimJob(db, { queue, ...lease })).toBeNull();

    expect(await completeJob(db, queued.id, "w1")).toBe(true);
    expect(await reload(queued.id)).toMatchObject({
      status: "succeeded",
      lockedBy: null,
    });
  });

  it("gives concurrent workers different jobs", async () => {
    const queue = newQueue();
    await enqueue(db, { queue, type: "t", payload: {} });
    await enqueue(db, { queue, type: "t", payload: {} });

    const claims = await Promise.all(
      ["a", "b", "c"].map((workerId) =>
        claimJob(db, { queue, workerId, leaseMs: 60_000 }),
      ),
    );
    const ids = claims.filter((c) => c !== null).map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("reclaims a job whose lease expired, and fences off the old worker", async () => {
    const queue = newQueue();
    const queued = await enqueue(db, { queue, type: "t", payload: {} });
    await claimJob(db, { queue, workerId: "crashed", leaseMs: 1 });
    await new Promise((r) => setTimeout(r, 20));

    const reclaimed = await claimJob(db, { queue, ...lease });
    expect(reclaimed).toMatchObject({ id: queued.id, attempts: 2 });

    // The original worker has lost the lease and can no longer change the job.
    expect(await heartbeat(db, queued.id, "crashed", 60_000)).toBe(false);
    expect(await completeJob(db, queued.id, "crashed")).toBe(false);
    expect(await heartbeat(db, queued.id, "w1", 60_000)).toBe(true);
  });

  it("requeues a failed attempt after a delay, or fails it permanently", async () => {
    const queue = newQueue();
    const queued = await enqueue(db, { queue, type: "t", payload: {} });
    await claimJob(db, { queue, ...lease });

    await failJob(db, queued.id, "w1", { error: "boom", retryInMs: 60_000 });
    expect(await reload(queued.id)).toMatchObject({
      status: "queued",
      lastError: "boom",
    });
    // Not due yet.
    expect(await claimJob(db, { queue, ...lease })).toBeNull();

    await db
      .update(job)
      .set({ runAt: new Date(0) })
      .where(eq(job.id, queued.id));
    await claimJob(db, { queue, ...lease });
    await failJob(db, queued.id, "w1", { error: "fatal", retryInMs: null });
    expect(await reload(queued.id)).toMatchObject({
      status: "failed",
      lastError: "fatal",
      attempts: 2,
    });
  });

  describe("processNextJob", () => {
    function handler(overrides: Partial<JobHandler> = {}): JobHandler {
      return {
        run: vi.fn(async () => {}),
        isRetryable: () => true,
        onRetry: vi.fn(async () => {}),
        onFailed: vi.fn(async () => {}),
        ...overrides,
      };
    }

    const options = (queue: string, handlers: Record<string, JobHandler>) => ({
      queue,
      workerId: "w1",
      handlers,
      backoff: () => 0,
    });

    it("returns idle when there is nothing to do", async () => {
      const result = await processNextJob(db, options(newQueue(), {}));
      expect(result).toEqual({ outcome: "idle" });
    });

    it("runs the handler and completes the job", async () => {
      const queue = newQueue();
      const h = handler();
      const queued = await enqueue(db, { queue, type: "t", payload: { x: 1 } });

      const result = await processNextJob(db, options(queue, { t: h }));

      expect(result.outcome).toBe("succeeded");
      expect(h.run).toHaveBeenCalledWith(
        expect.objectContaining({ id: queued.id, payload: { x: 1 } }),
      );
      expect((await reload(queued.id)).status).toBe("succeeded");
    });

    it("retries retryable errors until attempts run out", async () => {
      const queue = newQueue();
      const h = handler({
        run: vi.fn(async () => {
          throw new Error("flaky");
        }),
      });
      const queued = await enqueue(db, {
        queue,
        type: "t",
        payload: {},
        maxAttempts: 2,
      });

      expect((await processNextJob(db, options(queue, { t: h }))).outcome).toBe(
        "retrying",
      );
      expect(h.onRetry).toHaveBeenCalledTimes(1);
      expect((await processNextJob(db, options(queue, { t: h }))).outcome).toBe(
        "failed",
      );
      expect(h.onFailed).toHaveBeenCalledTimes(1);
      expect(await reload(queued.id)).toMatchObject({
        status: "failed",
        attempts: 2,
        lastError: "flaky",
      });
    });

    it("fails non-retryable errors immediately", async () => {
      const queue = newQueue();
      const h = handler({
        run: vi.fn(async () => {
          throw new Error("bug");
        }),
        isRetryable: () => false,
      });
      await enqueue(db, { queue, type: "t", payload: {} });

      const result = await processNextJob(db, options(queue, { t: h }));

      expect(result.outcome).toBe("failed");
      expect(h.onRetry).not.toHaveBeenCalled();
      expect(h.onFailed).toHaveBeenCalledTimes(1);
    });

    it("fails a job reclaimed after its final attempt's lease expired", async () => {
      const queue = newQueue();
      const h = handler();
      const queued = await enqueue(db, {
        queue,
        type: "t",
        payload: {},
        maxAttempts: 1,
      });
      await claimJob(db, { queue, workerId: "crashed", leaseMs: 1 });
      await new Promise((r) => setTimeout(r, 20));

      const result = await processNextJob(db, options(queue, { t: h }));

      expect(result.outcome).toBe("failed");
      expect(h.run).not.toHaveBeenCalled();
      expect(h.onFailed).toHaveBeenCalledTimes(1);
      expect((await reload(queued.id)).status).toBe("failed");
    });

    it("fails jobs with no handler", async () => {
      const queue = newQueue();
      await enqueue(db, { queue, type: "unknown", payload: {} });
      const result = await processNextJob(db, options(queue, {}));
      expect(result.outcome).toBe("failed");
    });
  });
});
