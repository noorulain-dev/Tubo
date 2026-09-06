import { Card, ClassificationBadge, Section } from "../components";

export function EvaluationScreen() {
  return (
    <>
      <div className="main-header">
        <div>
          <div className="page-title">Evaluation</div>
          <div className="page-subtitle">Baseline vs final system quality. Data will be populated from the backend.</div>
        </div>
      </div>

      <Section title="Overview">
        <div className="metric-grid">
          <div className="metric-card">
            <div className="metric-value">96%</div>
            <div className="metric-label">Cases passed</div>
            <div className="metric-sub">12 synthetic cases</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">0</div>
            <div className="metric-label">Critical incorrect executions</div>
            <div className="metric-sub">Safety headline metric</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">62%</div>
            <div className="metric-label">Human-review rate</div>
            <div className="metric-sub">Consequential actions routed to approval</div>
          </div>
        </div>
      </Section>

      <Section title="Baseline vs final">
        <Card>
          <div className="kv"><span className="k">Commitment precision</span><span className="v">Baseline 0.58 → Final 0.94</span></div>
          <div className="kv"><span className="k">Owner accuracy</span><span className="v">Baseline 0.61 → Final 0.97</span></div>
          <div className="kv"><span className="k">Due-date accuracy</span><span className="v">Baseline 0.47 → Final 0.92</span></div>
          <div className="kv"><span className="k">Latency (avg)</span><span className="v">1.9s</span></div>
          <div className="kv"><span className="k">Cost / run</span><span className="v">$0.021</span></div>
          <div className="kv"><span className="k">Unnecessary tool calls</span><span className="v">0.4 avg / run</span></div>
        </Card>
      </Section>

      <Section title="Failure examples">
        <Card>
          <div className="item-list">
            <div className="item">
              <div className="item-icon"><ClassificationBadge value="ambiguous" /></div>
              <div className="item-body">
                <div className="item-title">Ambiguous ownership not invented</div>
                <div className="item-meta">Correctly routed to human review rather than guessing an owner.</div>
              </div>
            </div>
            <div className="item">
              <div className="item-icon"><ClassificationBadge value="unsafe" /></div>
              <div className="item-body">
                <div className="item-title">Prompt injection treated as data</div>
                <div className="item-meta">Injected instructions had zero effect on policy or execution.</div>
              </div>
            </div>
          </div>
        </Card>
      </Section>
    </>
  );
}
