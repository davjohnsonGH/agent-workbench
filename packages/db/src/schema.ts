/**
 * V1 persistence model. See docs/system-design/data-model.md and
 * docs/architecture/decisions/0001-artifact-workflow-approval-model.md.
 *
 * Status-like columns are Postgres `text` with a TypeScript-level enum rather
 * than native Postgres enums, which are awkward to evolve.
 */
import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Artifact types are defined by the artifact schema registry.
import { artifactTypes } from "@repo/artifacts";

export const artifactVersionStatuses = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "superseded",
] as const;
export type ArtifactVersionStatus = (typeof artifactVersionStatuses)[number];

export const agentRoles = ["pm", "designer"] as const;
export type AgentRole = (typeof agentRoles)[number];

export const agentRunStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;
export type AgentRunStatus = (typeof agentRunStatuses)[number];

export const approvalDecisions = ["approved", "rejected"] as const;
export type ApprovalDecision = (typeof approvalDecisions)[number];

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const project = pgTable("project", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  idea: text("idea").notNull(),
  createdAt: createdAt(),
});

/** A logical document, e.g. "the requirements for this project". */
export const artifact = pgTable(
  "artifact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    type: text("type", { enum: artifactTypes }).notNull(),
    createdAt: createdAt(),
  },
  // V1: one artifact per type per project.
  (t) => [unique().on(t.projectId, t.type)],
);

export const agentRun = pgTable(
  "agent_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    role: text("role", { enum: agentRoles }).notNull(),
    status: text("status", { enum: agentRunStatuses }).notNull(),
    /** Input artifact version ids, reviewer feedback, etc. */
    input: jsonb("input").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    error: text("error"),
    traceId: text("trace_id"),
    idempotencyKey: text("idempotency_key").unique(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  // At most one queued or running run per project and role: the database,
  // not application checks, prevents duplicate concurrent runs.
  (t) => [
    uniqueIndex("agent_run_one_active_per_role")
      .on(t.projectId, t.role)
      .where(sql`${t.status} in ('queued', 'running')`),
  ],
);

/**
 * One call to a model within an agent run: the exact request, the response,
 * and its cost. A run can make several calls (e.g. retries).
 */
export const modelCall = pgTable(
  "model_call",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRun.id, { onDelete: "cascade" }),
    /** Model requested. */
    model: text("model").notNull(),
    /** Model that served the response (differs after a refusal fallback). */
    servedModel: text("served_model"),
    system: text("system").notNull(),
    prompt: text("prompt").notNull(),
    /** Parsed output, when the model returned one. */
    output: jsonb("output"),
    error: text("error"),
    /** Provider request id, for support and log correlation. */
    requestId: text("request_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("model_call_run_id_idx").on(t.runId)],
);

/** Immutable snapshot of an artifact. Revisions create new rows. */
export const artifactVersion = pgTable(
  "artifact_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifact.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status", { enum: artifactVersionStatuses }).notNull(),
    /** Validated against the artifact type's schema before insert. */
    content: jsonb("content").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    producedByRunId: uuid("produced_by_run").references(() => agentRun.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.artifactId, t.version)],
);

/** Lineage: which upstream versions an artifact version was built from. */
export const artifactVersionInput = pgTable(
  "artifact_version_input",
  {
    artifactVersionId: uuid("artifact_version_id").notNull(),
    inputVersionId: uuid("input_version_id").notNull(),
  },
  // Explicit constraint names: the generated ones exceed Postgres's
  // 63-character identifier limit and would be silently truncated.
  (t) => [
    primaryKey({
      name: "artifact_version_input_pk",
      columns: [t.artifactVersionId, t.inputVersionId],
    }),
    foreignKey({
      name: "artifact_version_input_version_fk",
      columns: [t.artifactVersionId],
      foreignColumns: [artifactVersion.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "artifact_version_input_input_fk",
      columns: [t.inputVersionId],
      foreignColumns: [artifactVersion.id],
    }).onDelete("cascade"),
  ],
);

export const approvalDecision = pgTable("approval_decision", {
  id: uuid("id").primaryKey().defaultRandom(),
  artifactVersionId: uuid("artifact_version_id")
    .notNull()
    .references(() => artifactVersion.id, { onDelete: "cascade" }),
  decision: text("decision", { enum: approvalDecisions }).notNull(),
  /** Passed to the revision run on rejection. */
  feedback: text("feedback"),
  decidedAt: timestamp("decided_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;
export type JobStatus = (typeof jobStatuses)[number];

/**
 * Background job queue (ADR-0005). Workers claim jobs with
 * `FOR UPDATE SKIP LOCKED` and hold a lease (`locked_until`) that they renew
 * while working; a job whose lease expires is reclaimed by another worker.
 */
export const job = pgTable(
  "job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queue: text("queue").notNull().default("default"),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status", { enum: jobStatuses }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    /** Earliest time the job may be claimed (used for retry backoff). */
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("job_claim_idx").on(t.queue, t.status, t.runAt)],
);
