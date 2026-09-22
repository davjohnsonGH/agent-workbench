"use client";

import type { AgentRole } from "@repo/db";
import type { NextAction } from "@repo/workflow";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { postJson } from "@/lib/api";

import { roleLabels } from "./labels";

/** The single thing the user can do next, per the workflow. */
export function NextActionPanel({
  projectId,
  next,
  activeRun,
}: {
  projectId: string;
  next: NextAction;
  /** The queued or running agent, if any. */
  activeRun?: { role: AgentRole; status: "queued" | "running" };
}) {
  const router = useRouter();

  // The worker runs agents in the background: poll until the run finishes.
  useEffect(() => {
    if (next.type !== "wait") return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [next.type, router]);

  switch (next.type) {
    case "run":
      return (
        <RunPanel
          projectId={projectId}
          role={next.role}
          revision={next.revision}
        />
      );
    case "review":
      return <ReviewPanel versionId={next.versionId} />;
    case "wait":
      return (
        <section className="card">
          <h2>
            {activeRun
              ? `${roleLabels[activeRun.role]} ${activeRun.status === "queued" ? "queued" : "working"}…`
              : "Waiting"}
          </h2>
          <p className="muted">
            {activeRun?.status === "queued"
              ? "Waiting for a worker to pick up the run. If this doesn't change, check that the worker is running (npm run dev starts it)."
              : "The agent is running in the background. This page updates automatically."}
          </p>
        </section>
      );
    case "complete":
      return (
        <section className="card">
          <h2>All steps approved</h2>
          <p className="muted">Every artifact in the workflow is approved.</p>
        </section>
      );
  }
}

function RunPanel({
  projectId,
  role,
  revision,
}: {
  projectId: string;
  role: AgentRole;
  revision?: { versionId: string; feedback: string };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      await postJson(`/api/projects/${projectId}/run`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  const label = roleLabels[role];

  return (
    <section className="card">
      <h2>{revision ? `Revise with the ${label}` : `Run the ${label}`}</h2>
      {revision && (
        <p className="muted">
          The agent will revise the rejected version using your feedback:{" "}
          <em>“{revision.feedback}”</em>
        </p>
      )}
      <div className="row">
        <button className="primary" onClick={run} disabled={pending}>
          {pending ? "Queueing…" : revision ? "Revise" : "Run agent"}
        </button>
        <span className="muted">
          Runs take about a minute in the background.
        </span>
        {error && <span className="error">{error}</span>}
      </div>
    </section>
  );
}

function ReviewPanel({ versionId }: { versionId: string }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approved" | "rejected") {
    setPending(true);
    setError(null);
    try {
      await postJson(`/api/versions/${versionId}/decision`, {
        decision,
        feedback: feedback || undefined,
      });
      setFeedback("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card">
      <h2>Your review</h2>
      <p className="muted">
        Approve the version below to unlock the next step, or reject it with
        feedback for the agent to revise.
      </p>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Feedback (required to reject)"
      />
      <div className="row">
        <button
          className="primary"
          onClick={() => decide("approved")}
          disabled={pending}
        >
          Approve
        </button>
        <button
          className="danger"
          onClick={() => decide("rejected")}
          disabled={pending || !feedback.trim()}
        >
          Reject with feedback
        </button>
        {error && <span className="error">{error}</span>}
      </div>
    </section>
  );
}
