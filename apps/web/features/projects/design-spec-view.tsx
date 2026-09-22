import type { DesignSpec } from "@repo/artifacts";

export function DesignSpecView({ doc }: { doc: DesignSpec }) {
  return (
    <div className="doc">
      <p>{doc.overview}</p>

      <section className="doc">
        <h3>Screens ({doc.screens.length})</h3>
        {doc.screens.map((screen) => (
          <div key={screen.id} className="story">
            <div className="row">
              <code>{screen.id}</code>
              <strong>{screen.name}</strong>
              <StoryRefs ids={screen.userStoryIds} />
            </div>
            <p>{screen.purpose}</p>
            <ul className="muted">
              {screen.keyElements.map((element) => (
                <li key={element}>{element}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="doc">
        <h3>User flows ({doc.userFlows.length})</h3>
        {doc.userFlows.map((flow) => (
          <div key={flow.id} className="story">
            <div className="row">
              <code>{flow.id}</code>
              <strong>{flow.name}</strong>
              <StoryRefs ids={flow.userStoryIds} />
            </div>
            <ol className="muted">
              {flow.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        ))}
      </section>

      {doc.designDecisions.length > 0 && (
        <section>
          <h3>Design decisions</h3>
          <ul>
            {doc.designDecisions.map((d) => (
              <li key={d.decision}>
                <strong>{d.decision}</strong>: {d.rationale}
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

function StoryRefs({ ids }: { ids: string[] }) {
  return (
    <span className="muted">
      {ids.map((id) => (
        <code key={id}>{id} </code>
      ))}
    </span>
  );
}
