import { getRunDetail, WorkflowError } from "@repo/workflow";
import Link from "next/link";
import { notFound } from "next/navigation";

import { roleLabels, StatusBadge } from "@/features/projects/labels";
import { getDb, parseId } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = await params;

  let detail: Awaited<ReturnType<typeof getRunDetail>>;
  try {
    detail = await getRunDetail(getDb(), parseId(id), parseId(runId));
  } catch (error) {
    if (error instanceof WorkflowError) notFound();
    throw error;
  }
  const { run, calls, version, job } = detail;

  return (
    <main className="page">
      <header>
        <Link href={`/projects/${id}`} className="muted">
          ← Project
        </Link>
        <h1>{roleLabels[run.role]} run</h1>
        <div className="row">
          <StatusBadge status={run.status} />
          <span className="muted">
            {run.startedAt?.toLocaleString()} · trace <code>{run.traceId}</code>
          </span>
          {version && (
            <Link href={`/projects/${id}?v=${version.id}`}>
              Produced v{version.version}
            </Link>
          )}
        </div>
        {run.error && <p className="error">{run.error}</p>}
      </header>

      {job && (
        <section className="card">
          <h2>Queue job</h2>
          <table>
            <tbody>
              <tr>
                <th>Status</th>
                <td>
                  <StatusBadge status={job.status} />
                </td>
              </tr>
              <tr>
                <th>Attempts</th>
                <td>
                  {job.attempts} of {job.maxAttempts}
                </td>
              </tr>
              {job.status === "queued" && job.attempts > 0 && (
                <tr>
                  <th>Next attempt</th>
                  <td>{job.runAt.toLocaleString()}</td>
                </tr>
              )}
              {job.lockedBy && (
                <tr>
                  <th>Worker</th>
                  <td>
                    <code>{job.lockedBy}</code>
                  </td>
                </tr>
              )}
              {job.lastError && (
                <tr>
                  <th>Last error</th>
                  <td className="error">{job.lastError}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2>Run input</h2>
        <pre className="table-wrap">{JSON.stringify(run.input, null, 2)}</pre>
      </section>

      {calls.length === 0 && (
        <p className="muted">No model calls recorded for this run.</p>
      )}

      {calls.map((call, i) => (
        <section key={call.id} className="card">
          <div className="row">
            <h2>Model call {i + 1}</h2>
            {call.error ? (
              <span className="badge tone-danger">Error</span>
            ) : (
              <span className="badge tone-success">OK</span>
            )}
          </div>
          <table>
            <tbody>
              <tr>
                <th>Model</th>
                <td>
                  <code>{call.model}</code>
                  {call.servedModel && call.servedModel !== call.model && (
                    <>
                      {" "}
                      → served by <code>{call.servedModel}</code>
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <th>Tokens (in / out)</th>
                <td>
                  {call.inputTokens ?? "—"} / {call.outputTokens ?? "—"}
                </td>
              </tr>
              <tr>
                <th>Latency</th>
                <td>{(call.latencyMs / 1000).toFixed(1)}s</td>
              </tr>
              <tr>
                <th>Request id</th>
                <td>
                  <code>{call.requestId ?? "—"}</code>
                </td>
              </tr>
            </tbody>
          </table>
          {call.error && <p className="error">{call.error}</p>}
          <details>
            <summary>System prompt</summary>
            <pre className="table-wrap">{call.system}</pre>
          </details>
          <details>
            <summary>Prompt</summary>
            <pre className="table-wrap">{call.prompt}</pre>
          </details>
          <details open={call.output != null}>
            <summary>Output</summary>
            <pre className="table-wrap">
              {call.output == null
                ? "No output"
                : JSON.stringify(call.output, null, 2)}
            </pre>
          </details>
        </section>
      ))}
    </main>
  );
}
