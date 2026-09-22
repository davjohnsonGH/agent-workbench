import { listProjects } from "@repo/workflow";
import Link from "next/link";

import { NewProjectForm } from "@/features/projects/new-project-form";
import { getDb } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const projects = await listProjects(getDb());

  return (
    <main className="page">
      <header>
        <h1>Agent Workbench</h1>
        <p className="muted">
          A supervised AI software team: agents draft, you approve.
        </p>
      </header>

      <NewProjectForm />

      <section className="card">
        <h2>Projects</h2>
        {projects.length === 0 ? (
          <p className="muted">No projects yet.</p>
        ) : (
          <ul className="list">
            {projects.map((p) => (
              <li key={p.id} className="row">
                <Link href={`/projects/${p.id}`}>{p.name}</Link>
                <span className="muted">
                  {p.createdAt.toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
