import { artifactTypes, parseArtifactContent } from "@repo/artifacts";
import { getProjectDetail, WorkflowError } from "@repo/workflow";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  artifactLabels,
  roleLabels,
  StatusBadge,
} from "@/features/projects/labels";
import { DesignSpecView } from "@/features/projects/design-spec-view";
import { NextActionPanel } from "@/features/projects/next-action-panel";
import { RequirementsView } from "@/features/projects/requirements-view";
import { getDb, parseId } from "@/lib/server";

export const dynamic = "force-dynamic";

type Detail = Awaited<ReturnType<typeof getProjectDetail>>;

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v: selectedId } = await searchParams;

  let detail: Detail;
  try {
    detail = await getProjectDetail(getDb(), parseId(id));
  } catch (error) {
    if (error instanceof WorkflowError) notFound();
    throw error;
  }
  const { project, workflow, versions, runs } = detail;

  return (
    <main className="page">
      <header>
        <Link href="/" className="muted">
          ← Projects
        </Link>
        <h1>{project.name}</h1>
        <p className="muted">{project.idea}</p>
      </header>

      <section className="steps" aria-label="Workflow">
        {workflow.steps.map((step, i) => (
          <div key={step.role} className="step">
            <span className="muted">
              Step {i + 1} · {artifactLabels[step.produces]}
            </span>
            <strong>{roleLabels[step.role]}</strong>
            <span>
              <StatusBadge status={step.state.status} />
            </span>
          </div>
        ))}
      </section>

      <NextActionPanel projectId={project.id} next={workflow.next} />

      {artifactTypes.map((type) => {
        const typeVersions = versions.filter((v) => v.type === type);
        if (typeVersions.length === 0) return null;
        const selected =
          typeVersions.find((v) => v.id === selectedId) ?? typeVersions[0]!;
        return (
          <ArtifactCard
            key={type}
            title={artifactLabels[type]}
            projectId={project.id}
            versions={typeVersions}
            selected={selected}
          />
        );
      })}

      <RunsTable runs={runs} />
    </main>
  );
}

function ArtifactCard({
  title,
  projectId,
  versions,
  selected,
}: {
  title: string;
  projectId: string;
  versions: Detail["versions"];
  selected: Detail["versions"][number];
}) {
  return (
    <section className="card">
      <div className="row">
        <h2>{title}</h2>
        <nav className="tabs" aria-label={`${title} versions`}>
          {versions.map((v) => (
            <Link
              key={v.id}
              href={`/projects/${projectId}?v=${v.id}`}
              aria-current={v.id === selected.id ? "page" : undefined}
              scroll={false}
            >
              v{v.version}
            </Link>
          ))}
        </nav>
      </div>

      <div className="row">
        <StatusBadge status={selected.status} />
        <span className="muted">
          Version {selected.version} · {selected.createdAt.toLocaleString()}
        </span>
      </div>

      {selected.decisions.map((d) => (
        <p key={d.id} className="muted">
          {d.decision === "approved" ? "Approved" : "Rejected"}{" "}
          {d.decidedAt.toLocaleString()}
          {d.feedback && (
            <>
              : <em>“{d.feedback}”</em>
            </>
          )}
        </p>
      ))}

      <ArtifactContent version={selected} />
    </section>
  );
}

function ArtifactContent({ version }: { version: Detail["versions"][number] }) {
  switch (version.type) {
    case "requirements": {
      const parsed = parseArtifactContent("requirements", version.content);
      if (parsed.success) return <RequirementsView doc={parsed.data} />;
      break;
    }
    case "design_spec": {
      const parsed = parseArtifactContent("design_spec", version.content);
      if (parsed.success) return <DesignSpecView doc={parsed.data} />;
      break;
    }
  }
  // Content that no longer matches the current schema: show it raw.
  return (
    <pre className="table-wrap">{JSON.stringify(version.content, null, 2)}</pre>
  );
}

function RunsTable({ runs }: { runs: Detail["runs"] }) {
  if (runs.length === 0) return null;
  return (
    <section className="card">
      <h2>Agent runs</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Agent</th>
              <th>Status</th>
              <th>Model</th>
              <th>Tokens (in / out)</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{run.startedAt?.toLocaleString() ?? "—"}</td>
                <td>{roleLabels[run.role]}</td>
                <td>
                  <StatusBadge status={run.status} />
                  {run.error && <div className="error">{run.error}</div>}
                </td>
                <td>
                  <code>{run.model ?? "—"}</code>
                </td>
                <td>
                  {run.inputTokens ?? "—"} / {run.outputTokens ?? "—"}
                </td>
                <td>{formatDuration(run.startedAt, run.finishedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatDuration(start: Date | null, end: Date | null) {
  if (!start || !end) return "—";
  return `${((end.getTime() - start.getTime()) / 1000).toFixed(1)}s`;
}
