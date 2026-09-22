import type { ArtifactType } from "@repo/artifacts";
import type { AgentRole } from "@repo/db";

type Tone = "success" | "warning" | "danger" | "info" | "muted";

export const roleLabels: Record<AgentRole, string> = {
  pm: "Product Manager",
  designer: "Designer",
  engineer: "Engineer",
};

export const artifactLabels: Record<ArtifactType, string> = {
  requirements: "Requirements",
  design_spec: "Design spec",
  task_list: "Task list",
};

/** Labels and tones for step, version, and run statuses. */
export const statusStyles: Record<string, { label: string; tone: Tone }> = {
  // Workflow step states
  blocked: { label: "Blocked", tone: "muted" },
  ready: { label: "Ready", tone: "info" },
  running: { label: "Running", tone: "info" },
  awaiting_approval: { label: "Awaiting approval", tone: "warning" },
  needs_revision: { label: "Needs revision", tone: "danger" },
  // Artifact version statuses
  draft: { label: "Draft", tone: "muted" },
  pending_approval: { label: "Awaiting approval", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  superseded: { label: "Superseded", tone: "muted" },
  // Agent run statuses
  queued: { label: "Queued", tone: "muted" },
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export function StatusBadge({ status }: { status: string }) {
  const style = statusStyles[status] ?? { label: status, tone: "muted" };
  return <span className={`badge tone-${style.tone}`}>{style.label}</span>;
}
