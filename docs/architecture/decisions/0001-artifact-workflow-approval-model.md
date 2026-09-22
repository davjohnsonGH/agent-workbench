# ADR-0001: Artifacts, deterministic workflow, and approval gates as the core model

- **Status:** Proposed
- **Date:** 2026-09-22

## Context

Agent Workbench coordinates role-based AI agents (PM, Designer, later
Engineer) that turn a product idea into requirements, designs, tasks, and
eventually code. Two requirements shape the core architecture:

1. **Controlled autonomy.** Agents do bounded work on their own, but
   consequential steps (approving requirements, changing code, opening PRs,
   deploying) need human approval.
2. **Persistence and inspectability.** Outputs must be durable, structured,
   and traceable, not buried in chat transcripts.

Common multi-agent designs let agents converse freely and let an LLM decide
what runs next. That is flexible, but hard to debug, test, replay, or govern
with approval gates.

## Decision

The system is built around three concepts:

1. **Artifacts are the only channel between agents.** Every agent output is a
   typed artifact (e.g. `requirements`, `design_spec`, `task_list`) whose
   content is validated against a schema for that type. Artifacts are
   immutable and versioned: a revision creates a new version rather than
   editing in place. Each version records which artifact versions it was
   derived from. Agents never exchange free-form messages.

2. **A deterministic workflow decides what runs next.** The workflow is an
   explicit definition of the form "an approved artifact of type X makes agent
   role Y eligible to run." For V1 this is a fixed linear sequence:
   idea → PM → (approval) → Designer → (approval). LLM-driven routing may be
   added later as a separate, bounded decision step, evaluated against this
   deterministic baseline.

3. **Approval gates are first-class records.** An artifact version awaiting
   approval blocks downstream work. A human records an approval decision:
   approve (unlocking the next step) or reject with feedback (triggering a
   revision run that receives the feedback as input). Each artifact type
   declares whether it requires approval, so autonomy can be widened per type
   later without changing the engine.

Every agent execution is recorded as an **agent run** (inputs, output
artifact, status, model, token usage, trace ID), so any artifact can be traced
back to the run and inputs that produced it.

## Consequences

**Positive**

- Every handoff can be inspected, diffed across versions, replayed, and
  evaluated.
- Approval gates become a matter of workflow state, not prompt instructions.
- Schema validation keeps LLM output usable by downstream agents and the UI.
- The same records support observability, evals, and cost tracking.
- It leads naturally to async execution later: an agent run is a unit of work
  that can move onto a queue with retries and idempotency keys.

**Negative / tradeoffs**

- It is less flexible than free-form agent conversation, since emergent
  collaboration patterns are not possible until routing is relaxed.
- Each new artifact type needs a schema, a UI rendering, and a workflow
  entry.
- Immutable versioning uses more storage and needs a clear "current version"
  rule.

## Alternatives considered

- **Free-form agent chat (group-chat style):** rejected for V1 because it is
  opaque, hard to gate, and hard to evaluate.
- **LLM planner decides all routing:** deferred. Worth exploring once there is
  a deterministic baseline to compare against.
- **Mutable documents edited in place:** rejected because it loses the
  history needed for review, feedback loops, and reproducibility.
