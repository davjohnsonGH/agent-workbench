"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { postJson } from "@/lib/api";

export function NewProjectForm() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const project = await postJson<{ id: string }>("/api/projects", {
        idea,
      });
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setPending(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>New project</h2>
      <label className="muted" htmlFor="idea">
        Describe a product or feature idea. The PM agent turns it into
        requirements for your review.
      </label>
      <textarea
        id="idea"
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="A meal planner for busy families"
        required
      />
      <div className="row">
        <button className="primary" disabled={pending || !idea.trim()}>
          {pending ? "Creating…" : "Create project"}
        </button>
        {error && <span className="error">{error}</span>}
      </div>
    </form>
  );
}
