import {
  type ArtifactSnapshot,
  computeWorkflowState,
  type ProjectSnapshot,
} from "@repo/workflow";
import { describe, expect, it } from "vitest";

function latest(
  status: ArtifactSnapshot["latest"]["status"],
  extra: Partial<ArtifactSnapshot["latest"]> = {},
): ArtifactSnapshot {
  return {
    latest: { id: "v1", version: 1, status, feedback: null, ...extra },
    hasApproved: status === "approved",
  };
}

function state(snapshot: Partial<ProjectSnapshot>) {
  return computeWorkflowState({ artifacts: {}, activeRoles: [], ...snapshot });
}

describe("computeWorkflowState", () => {
  it("starts with the PM ready and the designer blocked", () => {
    const result = state({});
    expect(result.steps.map((s) => s.state)).toEqual([
      { status: "ready" },
      { status: "blocked", waitingOn: ["requirements"] },
    ]);
    expect(result.next).toEqual({ type: "run", role: "pm" });
  });

  it("waits while the PM is running", () => {
    const result = state({ activeRoles: ["pm"] });
    expect(result.steps[0]?.state).toEqual({ status: "running" });
    expect(result.next).toEqual({ type: "wait" });
  });

  it("asks for review when requirements await approval", () => {
    const result = state({
      artifacts: { requirements: latest("pending_approval") },
    });
    expect(result.next).toEqual({ type: "review", versionId: "v1" });
  });

  it("runs a revision with the reviewer's feedback after rejection", () => {
    const result = state({
      artifacts: {
        requirements: latest("rejected", { feedback: "Smaller scope" }),
      },
    });
    expect(result.steps[0]?.state).toEqual({
      status: "needs_revision",
      versionId: "v1",
      feedback: "Smaller scope",
    });
    expect(result.next).toEqual({
      type: "run",
      role: "pm",
      revision: { versionId: "v1", feedback: "Smaller scope" },
    });
  });

  it("unblocks the designer once requirements are approved", () => {
    const result = state({ artifacts: { requirements: latest("approved") } });
    expect(result.steps[1]?.state).toEqual({ status: "ready" });
    expect(result.next).toEqual({ type: "run", role: "designer" });
  });

  it("is complete when every step is approved", () => {
    const result = state({
      artifacts: {
        requirements: latest("approved"),
        design_spec: latest("approved", { id: "d1" }),
      },
    });
    expect(result.next).toEqual({ type: "complete" });
  });
});
