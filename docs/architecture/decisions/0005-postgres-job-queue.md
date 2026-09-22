# ADR-0005: Run agents on a Postgres-backed job queue

- **Status:** Accepted
- **Date:** 2026-09-22

## Context

Agent runs took about a minute inside the HTTP request that started them
(ADR-0003). That ties up a request, loses the run if the web process restarts,
offers no retries for transient API failures, and left a known race: two
simultaneous "run" requests could start duplicate runs.

## Decision

Agent runs execute in a separate **worker process** (`apps/worker`), fed by a
**job queue in Postgres** (`@repo/queue`, `job` table). No separate broker.

- **Enqueue atomically.** `enqueueNextStep` creates the `agent_run` (status
  `queued`) and its job in one transaction, and the API returns immediately.
- **Claim with `FOR UPDATE SKIP LOCKED`.** Concurrent workers claim different
  jobs without blocking each other. All times come from the database clock
  (`now()`), so workers' clocks do not matter.
- **Leases, not locks held for the whole run.** A claim sets `locked_until`,
  and the worker renews it with a heartbeat while it works. If a worker dies,
  its lease expires and another worker reclaims the job. Completing or failing
  a job requires still holding the lease, which fences off a worker whose lease
  was lost.
- **Retries with exponential backoff and jitter** (~5s, 10s, 20s, capped at
  5 minutes, `max_attempts` 3) for transient errors: timeouts, 429/5xx,
  connection errors, and bad output (a new sample may fix it). Refusals and
  other errors fail immediately. Every attempt is traced (ADR-0004), and run
  token totals sum over all attempts.
- **At-least-once delivery, made safe by idempotent execution.** The artifact
  version and the run's `succeeded` status are committed in one transaction,
  and executing an already-succeeded run is a no-op. So a job delivered again
  (e.g. the worker crashed after committing but before marking the job done)
  does not call the model twice or create a duplicate version.
- **The database enforces one active run per role.** A partial unique index
  on `agent_run (project_id, role) WHERE status IN ('queued', 'running')`
  rejects a concurrent duplicate, which the API reports as 409.
- **Graceful shutdown.** SIGINT/SIGTERM stop claiming new jobs, and the job in
  progress finishes.

## Consequences

- One datastore to run and back up. Enqueueing is transactional with the rows
  it refers to, which a separate broker cannot offer without an outbox.
- Workers scale horizontally, up to what polling Postgres comfortably
  supports (roughly hundreds of jobs per second with this design, far above
  our needs). The UI polls for run status.
- Remaining exposure: if a worker loses its lease mid-call (for example the
  database is unreachable for longer than the lease) and another worker
  reclaims the job, both may call the model. The final commit is still
  guarded, but the extra call costs money. Leases are 5 minutes, and runs take
  about 1.
- Polling adds up to 1s of latency before a job starts. `LISTEN/NOTIFY` could
  remove it if that ever matters.

## Alternatives considered

- **pg-boss / Graphile Worker:** mature Postgres queues. Hand-rolling was
  chosen for learning value, and the core is about 200 lines with tests.
  Switching later is straightforward because the handler interface is small.
- **Redis + BullMQ:** the common production choice, but it adds a second
  datastore, and enqueueing could not share a transaction with the run.
