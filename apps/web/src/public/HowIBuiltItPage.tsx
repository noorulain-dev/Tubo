import { PublicArticle } from "./PublicLayout";

const JUDGEMENT = [
  {
    title: "Rejecting an evaluator that wasn't testing the real system",
    body: "An early harness scored a simplified path rather than the production semantic model. Its numbers looked fine and meant nothing, so it was thrown away and rebuilt against the real pipeline.",
  },
  {
    title: "Investigating model availability instead of accepting a tooling conclusion",
    body: "A tool reported a model as unavailable. Verifying it directly showed otherwise, which changed the model decision and the cost profile of the system.",
  },
  {
    title: "Refusing brittle benchmark-specific fixes",
    body: "Several failures could have been made to pass with case-specific handling. They were fixed in the general logic or left failing and documented instead.",
  },
  {
    title: "Preserving frozen evaluation ground truth",
    body: "Ground truth was frozen before tuning and never edited to match model output, so improvements are comparable across versions.",
  },
  {
    title: "Separating reasoning authority from execution authority",
    body: "The model proposes; deterministic code executes, behind an explicit approval. This boundary was designed first and constrained everything built after it.",
  },
];

export function HowIBuiltItPage() {
  return (
    <PublicArticle
      title="How I Built It"
      lead="The engineering and product judgement behind Tubo — what the system is allowed to believe, and who is allowed to act."
    >
      <section>
        <h2>Problem selection and user research</h2>
        <p>
          I chose a workflow with a real operator behind it and spent the early time understanding the recurring cost:
          reconciliation across tools, not note-taking. That framing determined the architecture more than any model
          choice did.
        </p>
      </section>

      <section>
        <h2>Scope and architecture</h2>
        <p>
          I scoped the system to reconciliation across four sources with bounded retrieval, an explicit policy layer, and
          a deterministic execution path. Anything that would have made the demo prettier but the state less trustworthy
          was cut.
        </p>
      </section>

      <section>
        <h2>Source authority and AI authority limits</h2>
        <p>
          I defined which source is authoritative per fact class, what the model is permitted to infer, and where the
          system must fail closed. Missing commercial context blocks a recommendation instead of producing a confident
          guess.
        </p>
      </section>

      <section>
        <h2>Evaluation methodology</h2>
        <p>
          I built frozen ground truth first, then layered the metrics: semantic extraction quality, required-context
          retrieval, reconciliation classification, and safety behaviour — with repeated runs for stability and an
          architecture comparison to justify bounded retrieval.
        </p>
      </section>

      <section>
        <h2>Judgement calls that mattered</h2>
        <div className="judgement-grid">
          {JUDGEMENT.map((j) => (
            <div className="judgement-card" key={j.title}>
              <h3>{j.title}</h3>
              <p>{j.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Acceptance criteria and deployment</h2>
        <p>
          Shipping required a passing frozen gate, zero unsafe external executions, zero approval bypasses, and stable
          repeated runs. Those criteria were set before the results existed.
        </p>
      </section>

      <section>
        <h2>AI-assisted development</h2>
        <p>
          I used AI development tools throughout the sprint to accelerate implementation, debugging, testing, refactoring
          and documentation. Their output remained subject to the same architecture constraints, evaluation, review and
          rejection as any other engineering input.
        </p>
      </section>

      <section className="closing">
        <p>
          AI accelerated implementation. I remained responsible for what the system was allowed to believe, what evidence
          counted as authoritative, how quality was measured, when automation was unsafe, and whether the final system
          was ready to ship.
        </p>
      </section>
    </PublicArticle>
  );
}
