import type { TaskList } from "@repo/artifacts";

const estimateTone = { S: "success", M: "warning", L: "danger" } as const;

export function TaskListView({ doc }: { doc: TaskList }) {
  const counts = { S: 0, M: 0, L: 0 };
  for (const task of doc.tasks) counts[task.estimate] += 1;

  return (
    <div className="doc">
      <p>{doc.overview}</p>

      <section className="doc">
        <div className="row">
          <h3>Tasks ({doc.tasks.length})</h3>
          <span className="muted">
            {counts.S} small · {counts.M} medium · {counts.L} large
          </span>
        </div>
        {doc.tasks.map((task) => (
          <div key={task.id} className="story">
            <div className="row">
              <code>{task.id}</code>
              <strong>{task.title}</strong>
              <span className={`badge tone-${estimateTone[task.estimate]}`}>
                {task.estimate}
              </span>
            </div>
            <p>{task.description}</p>
            <p className="muted">
              {task.userStoryIds.length > 0 && (
                <>Stories: {task.userStoryIds.join(", ")}. </>
              )}
              {task.screenIds.length > 0 && (
                <>Screens: {task.screenIds.join(", ")}. </>
              )}
              {task.dependsOn.length > 0 && (
                <>After: {task.dependsOn.join(", ")}.</>
              )}
            </p>
            <ul className="muted">
              {task.acceptanceCriteria.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {doc.risks.length > 0 && (
        <section>
          <h3>Risks</h3>
          <ul>
            {doc.risks.map((r) => (
              <li key={r.risk}>
                <strong>{r.risk}</strong>: {r.mitigation}
              </li>
            ))}
          </ul>
        </section>
      )}

      {doc.openQuestions.length > 0 && (
        <section>
          <h3>Open questions</h3>
          <ul>
            {doc.openQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
