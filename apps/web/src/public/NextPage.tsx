import { PublicArticle } from "./PublicLayout";

const WEEK_ONE = [
  "Interaction → review-ready time",
  "Manual touches per account",
  "Acceptance without edit",
  "Correction rate",
  "Duplicate actions prevented",
  "Confirmed vs rejected execution gaps",
  "Time until CRM is current",
  "Provider failure rate",
  "Missing-context rate",
  "Unsafe recommendation rate",
  "Approval bypass attempts",
];

const WEEK_TWO = [
  { title: "Ranking", body: "Re-rank the attention queue against what the operator actually opened first." },
  { title: "Account matching", body: "Tighten identity resolution where interactions attached to the wrong account." },
  { title: "Onboarding", body: "Shorten first-run setup based on where pilot users stalled." },
  { title: "Provider resilience", body: "Add retry and degraded-mode behaviour for the providers that failed most." },
  { title: "Explanations", body: "Improve the plain-English 'why it matters' copy for the finding types that got questioned." },
  { title: "Latency and cost", body: "Trim retrieval where evidence showed calls that changed no outcome." },
];

export function NextPage() {
  return (
    <PublicArticle
      title="What's Next"
      lead="A two-week pilot plan: one week measuring real usage, one week improving against that evidence."
    >
      <p className="label-flag">Any forward-looking number below is a target or hypothesis, not a measured result.</p>

      <section>
        <h2>Week 1 — observe and measure</h2>
        <p>Run Tubo alongside the operator's real workflow without changing it, and instrument the workflow honestly.</p>
        <ul className="value-list">
          {WEEK_ONE.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Week 2 — improve against evidence</h2>
        <div className="judgement-grid">
          {WEEK_TWO.map((w) => (
            <div className="judgement-card" key={w.title}>
              <h3>{w.title}</h3>
              <p>{w.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>How success will be judged</h2>
        <p>
          A successful pilot means the operator trusts the reconciled state enough to act from it, corrections fall week
          over week, and no unsafe action reaches an external system. Targets will be set from week-one baselines rather
          than asserted now.
        </p>
      </section>
    </PublicArticle>
  );
}
