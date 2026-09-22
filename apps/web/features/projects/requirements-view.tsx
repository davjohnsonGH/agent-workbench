import type { Requirements } from "@repo/artifacts";

export function RequirementsView({ doc }: { doc: Requirements }) {
  return (
    <div className="doc">
      <p>{doc.summary}</p>

      <Section title="Goals" items={doc.goals} />
      <Section title="Non-goals" items={doc.nonGoals} />

      <section>
        <h3>Target users</h3>
        <ul>
          {doc.targetUsers.map((u) => (
            <li key={u.name}>
              <strong>{u.name}</strong>: {u.description}
            </li>
          ))}
        </ul>
      </section>

      <section className="doc">
        <h3>User stories ({doc.userStories.length})</h3>
        {doc.userStories.map((story) => (
          <div key={story.id} className="story">
            <div className="row">
              <code>{story.id}</code>
              <span className={`badge tone-${priorityTone[story.priority]}`}>
                {story.priority}
              </span>
            </div>
            <p>
              As a <strong>{story.asA}</strong>, I want {story.iWant}, so that{" "}
              {story.soThat}.
            </p>
            <ul className="muted">
              {story.acceptanceCriteria.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <Section title="Constraints" items={doc.constraints} />
      <Section title="Open questions" items={doc.openQuestions} />
    </div>
  );
}

const priorityTone = {
  must: "danger",
  should: "warning",
  could: "muted",
} as const;

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
