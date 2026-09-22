import { type Db, type DbOrTx, job } from "@repo/db";
import { and, eq, inArray, lt, lte, or, sql } from "drizzle-orm";

export type JobRow = typeof job.$inferSelect;

export interface EnqueueInput {
  queue?: string;
  type: string;
  payload: unknown;
  maxAttempts?: number;
}

/** Add a job. Accepts a transaction so a job can be created atomically with the work it refers to. */
export async function enqueue(
  db: DbOrTx,
  input: EnqueueInput,
): Promise<JobRow> {
  const [row] = await db
    .insert(job)
    .values({
      queue: input.queue,
      type: input.type,
      payload: input.payload,
      maxAttempts: input.maxAttempts,
    })
    .returning();
  if (!row) throw new Error("Failed to enqueue job");
  return row;
}

export interface ClaimOptions {
  queue: string;
  workerId: string;
  leaseMs: number;
}

/** Postgres interval for a millisecond duration, computed in the database. */
function interval(ms: number) {
  return sql`make_interval(secs => ${ms / 1000})`;
}

/**
 * Claim the next available job: one that is queued and due, or running with an
 * expired lease (its worker died). `FOR UPDATE SKIP LOCKED` lets concurrent
 * workers claim different jobs without blocking each other. Times come from
 * the database clock, so workers' clocks do not matter.
 */
export async function claimJob(
  db: Db,
  { queue, workerId, leaseMs }: ClaimOptions,
): Promise<JobRow | null> {
  const next = db
    .select({ id: job.id })
    .from(job)
    .where(
      and(
        eq(job.queue, queue),
        or(
          and(eq(job.status, "queued"), lte(job.runAt, sql`now()`)),
          and(eq(job.status, "running"), lt(job.lockedUntil, sql`now()`)),
        ),
      ),
    )
    .orderBy(job.runAt, job.createdAt)
    .limit(1)
    .for("update", { skipLocked: true });

  const [claimed] = await db
    .update(job)
    .set({
      status: "running",
      attempts: sql`${job.attempts} + 1`,
      lockedBy: workerId,
      lockedUntil: sql`now() + ${interval(leaseMs)}`,
      updatedAt: sql`now()`,
    })
    .where(inArray(job.id, next))
    .returning();
  return claimed ?? null;
}

/** Only the worker holding a job's lease may change it. */
function ownedBy(jobId: string, workerId: string) {
  return and(
    eq(job.id, jobId),
    eq(job.lockedBy, workerId),
    eq(job.status, "running"),
  );
}

/** Extend the lease. Returns false if the worker no longer owns the job. */
export async function heartbeat(
  db: Db,
  jobId: string,
  workerId: string,
  leaseMs: number,
): Promise<boolean> {
  const rows = await db
    .update(job)
    .set({
      lockedUntil: sql`now() + ${interval(leaseMs)}`,
      updatedAt: sql`now()`,
    })
    .where(ownedBy(jobId, workerId))
    .returning({ id: job.id });
  return rows.length > 0;
}

/** Mark a job succeeded. Returns false if the worker no longer owns it. */
export async function completeJob(
  db: Db,
  jobId: string,
  workerId: string,
): Promise<boolean> {
  const rows = await db
    .update(job)
    .set({
      status: "succeeded",
      lockedBy: null,
      lockedUntil: null,
      updatedAt: sql`now()`,
      finishedAt: sql`now()`,
    })
    .where(ownedBy(jobId, workerId))
    .returning({ id: job.id });
  return rows.length > 0;
}

/**
 * Record a failed attempt: requeue after `retryInMs`, or, when null, fail the
 * job permanently. Returns false if the worker no longer owns it.
 */
export async function failJob(
  db: Db,
  jobId: string,
  workerId: string,
  { error, retryInMs }: { error: string; retryInMs: number | null },
): Promise<boolean> {
  const rows = await db
    .update(job)
    .set(
      retryInMs === null
        ? {
            status: "failed",
            lastError: error,
            lockedBy: null,
            lockedUntil: null,
            updatedAt: sql`now()`,
            finishedAt: sql`now()`,
          }
        : {
            status: "queued",
            lastError: error,
            runAt: sql`now() + ${interval(retryInMs)}`,
            lockedBy: null,
            lockedUntil: null,
            updatedAt: sql`now()`,
          },
    )
    .where(ownedBy(jobId, workerId))
    .returning({ id: job.id });
  return rows.length > 0;
}

/** Exponential backoff with jitter: ~5s, 10s, 20s, … capped at 5 minutes. */
export function exponentialBackoff(
  attempt: number,
  { baseMs = 5_000, maxMs = 300_000 } = {},
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.round(ceiling * (0.5 + Math.random() / 2));
}
