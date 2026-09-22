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
}: {
  projectId: string;
  next: NextAction;
}) {
  const router = useRouter();

  // Another tab or request may be running an agent: refresh until it finishes.
  useEffect(() => {
    if (next.type !== "wait") return;
    const timer = setInterval(() => router.refresh(), 5000);
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
          <h2>Waiting</h2>
          <p className="muted">
            An agent is running. This page refreshes automatically.
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
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [startedAt]);

  async function run() {
    setStartedAt(Date.now());
    setElapsed(0);
    setError(null);
    try {
      await postJson(`/api/projects/${projectId}/run`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStartedAt(null);
      router.refresh();
    }
  }

  const label = roleLabels[role];
  const running = startedAt !== null;

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
        <button className="primary" onClick={run} disabled={running}>
          {running ? `Running… ${elapsed}s` : revision ? "Revise" : "Run agent"}
        </button>
        {running && (
          <span className="muted">Agent runs usually take about a minute.</span>
        )}
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
