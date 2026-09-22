import type { Db } from "@repo/db";

import {
  claimJob,
  completeJob,
  exponentialBackoff,
  failJob,
  heartbeat,
  type JobRow,
} from "./queue";

export interface JobHandler {
  run(job: JobRow): Promise<void>;
  /** Whether an error is worth retrying. Defaults to never retrying. */
  isRetryable?(error: unknown): boolean;
  /** Called before a failed attempt is requeued. */
  onRetry?(job: JobRow, error: unknown): Promise<void>;
  /** Called when the job fails permanently. Must be idempotent. */
  onFailed?(job: JobRow, error: unknown): Promise<void>;
}

export interface WorkerOptions {
  queue: string;
  workerId: string;
  handlers: Record<string, JobHandler>;
  leaseMs?: number;
  /** Delay before retrying after a given attempt number (1-based). */
  backoff?: (attempt: number) => number;
}

export type JobOutcome =
  | { outcome: "idle" }
  | {
      outcome: "succeeded" | "retrying" | "failed";
      job: JobRow;
      error?: unknown;
    };

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

/** Claim and process at most one job. */
export async function processNextJob(
  db: Db,
  options: WorkerOptions,
): Promise<JobOutcome> {
  const { workerId, handlers } = options;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const backoff = options.backoff ?? exponentialBackoff;

  const claimed = await claimJob(db, {
    queue: options.queue,
    workerId,
    leaseMs,
  });
  if (!claimed) return { outcome: "idle" };

  const handler = handlers[claimed.type];
  const fail = async (error: unknown) => {
    await handler?.onFailed?.(claimed, error);
    await failJob(db, claimed.id, workerId, {
      error: errorMessage(error),
      retryInMs: null,
    });
    return { outcome: "failed" as const, job: claimed, error };
  };

  if (!handler) {
    return fail(new Error(`No handler for job type "${claimed.type}"`));
  }
  // Reclaimed after its lease expired on the final attempt.
  if (claimed.attempts > claimed.maxAttempts) {
    return fail(new Error("Job exceeded its maximum attempts"));
  }

  // Renew the lease while working so other workers do not reclaim the job.
  const timer = setInterval(() => {
    heartbeat(db, claimed.id, workerId, leaseMs).catch(() => {});
  }, leaseMs / 3);

  try {
    await handler.run(claimed);
    await completeJob(db, claimed.id, workerId);
    return { outcome: "succeeded", job: claimed };
  } catch (error) {
    const retry =
      claimed.attempts < claimed.maxAttempts &&
      (handler.isRetryable?.(error) ?? false);
    if (!retry) return await fail(error);

    await handler.onRetry?.(claimed, error);
    await failJob(db, claimed.id, workerId, {
      error: errorMessage(error),
      retryInMs: backoff(claimed.attempts),
    });
    return { outcome: "retrying", job: claimed, error };
  } finally {
    clearInterval(timer);
  }
}

/**
 * Process jobs until `signal` aborts, polling when the queue is empty. The
 * job in progress when the signal fires is allowed to finish.
 */
export async function runWorker(
  db: Db,
  options: WorkerOptions & {
    signal: AbortSignal;
    pollMs?: number;
    onOutcome?: (outcome: JobOutcome) => void;
    onError?: (error: unknown) => void;
  },
): Promise<void> {
  const pollMs = options.pollMs ?? 1000;
  while (!options.signal.aborted) {
    try {
      const result = await processNextJob(db, options);
      options.onOutcome?.(result);
      if (result.outcome === "idle") await sleep(pollMs, options.signal);
    } catch (error) {
      // e.g. the database is unreachable: report and back off.
      options.onError?.(error);
      await sleep(pollMs * 5, options.signal);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
