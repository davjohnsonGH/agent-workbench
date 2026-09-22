/**
 * V1 persistence model. See docs/system-design/data-model.md and
 * docs/architecture/decisions/0001-artifact-workflow-approval-model.md.
 *
 * Status-like columns are Postgres `text` with a TypeScript-level enum rather
 * than native Postgres enums, which are awkward to evolve.
 */
import {
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const artifactTypes = ["requirements", "design_spec"] as const;
export type ArtifactType = (typeof artifactTypes)[number];

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

export const agentRun = pgTable("agent_run", {
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
});

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
    producedByRunId: uuid("produced_by_run").references(() => agentRun.id),
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
    }),
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
