# ADR-0004: Store model-call traces in Postgres

- **Status:** Accepted
- **Date:** 2026-09-22

## Context

Debugging agent output, tuning prompts, and building evals all need the exact
request and response for each model call. Until now `agent_run` held only
totals (tokens, model, error). The data model left open whether full prompts
and completions belong in Postgres or in an external tracing backend.

## Decision

Every call to a model is stored as a `model_call` row linked to its
`agent_run`. Each row holds the system prompt, prompt, parsed output (also
kept on failure, e.g. when a cross-artifact check rejects it), error, provider
request id, the requested and served model, tokens, and latency. A run can have
several calls (retries), so calls get their own table rather than more columns
on the run. The project UI shows each run's trace at
`/projects/:id/runs/:runId`.

## Consequences

- No new infrastructure. Traces live next to the artifacts they explain and
  are covered by the same backups, so a single SQL query can join a version
  to the exact prompt that produced it.
- Rows are large (prompts include upstream artifacts). That is fine at V1
  volume. Revisit with retention or an external store (e.g. OpenTelemetry to
  a tracing backend) when volume or cross-service tracing makes it worthwhile.
  `agent_run.trace_id` is already there to correlate with such a system.
- Evals can replay or grade stored outputs without re-running the model.
