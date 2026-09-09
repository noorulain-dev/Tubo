import { ShieldCheck } from "lucide-react";
import { useEvaluationSummary } from "../hooks";
import { EmptyState, ErrorNotice, Skeleton } from "../components/States";
import type { EvalArchitectureArm, EvaluationSummary } from "../types";

/** Every number on this page comes from the backend evaluation summary. */
function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}
function n(v: number | null): string {
  return v === null ? "—" : String(v);
}
function ratio(a: number | null, b: number | null): string {
  return a === null || b === null ? "—" : `${a}/${b}`;
}

function Metric({ label, value, tone = "neutral", hint }: { label: string; value: string; tone?: "neutral" | "ok" | "warn"; hint?: string }) {
  return (
    <div className={`metric metric-${tone}`}>
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
      {hint && <span className="metric-hint">{hint}</span>}
    </div>
  );
}

function ArmColumn({ title, arm }: { title: string; arm: EvalArchitectureArm }) {
  return (
    <div className="arch-arm">
      <h4>{title}</h4>
      <dl className="panel-kv">
        <div>
          <dt>Correct cases</dt>
          <dd>{n(arm.correct)}</dd>
        </div>
        <div>
          <dt>Gap classification correct</dt>
          <dd>{n(arm.gapCorrect)}</dd>
        </div>
        <div>
          <dt>Required retrieval recall</dt>
          <dd>{pct(arm.requiredRetrievalRecall)}</dd>
        </div>
        <div>
          <dt>Average tool calls</dt>
          <dd>{arm.avgToolCalls === null ? "—" : arm.avgToolCalls.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Unnecessary calls</dt>
          <dd>{n(arm.unnecessaryToolCalls)}</dd>
        </div>
        <div>
          <dt>Missing-context cases</dt>
          <dd>{n(arm.missingContextCases)}</dd>
        </div>
      </dl>
    </div>
  );
}

function Report({ s }: { s: EvaluationSummary }) {
  const { official, stability, supplemental, architecture } = s;
  return (
    <>
      <div className="eval-hero">
        <div>
          <span className="eval-kicker">System evaluation</span>
          <h2>
            {ratio(official.casesPassed, official.casesTotal)} official frozen cases passed
          </h2>
          <p>
            Evaluation uses frozen synthetic scenarios designed to test semantic interpretation, retrieval, reconciliation
            and safety.
          </p>
          <div className="eval-hero-meta">
            {s.gate && <span className={`gate gate-${s.gate.toLowerCase()}`}>Gate {s.gate}</span>}
            {s.model && <span className="tag tag-muted">Model {s.model}</span>}
            {s.reasoningEffort && <span className="tag tag-muted">Reasoning {s.reasoningEffort}</span>}
            {s.generatedAt && <span className="tag tag-muted">Generated {new Date(s.generatedAt).toLocaleDateString()}</span>}
          </div>
        </div>
      </div>

      <section className="eval-section">
        <h3>Official frozen evaluation</h3>
        <div className="metric-grid">
          <Metric label="Cases passed" value={ratio(official.casesPassed, official.casesTotal)} tone="ok" />
          <Metric label="Cases failed" value={n(official.casesFailed)} />
          <Metric label="Commitment precision" value={pct(official.layerA.commitmentPrecision)} />
          <Metric label="Commitment recall" value={pct(official.layerA.commitmentRecall)} />
          <Metric label="Owner accuracy" value={pct(official.layerA.ownerAccuracy)} />
          <Metric label="Date accuracy" value={pct(official.layerA.dateAccuracy)} />
          <Metric label="Evidence validity" value={pct(official.layerA.evidenceValidity)} />
          <Metric label="Classification accuracy" value={pct(official.layerC.classificationAccuracy)} />
        </div>
      </section>

      <section className="eval-section">
        <h3>Stability</h3>
        <div className="metric-grid">
          <Metric label="Repeat runs" value={stability.runs.length ? stability.runs.join(" · ") : "—"} />
          <Metric label="Mean passed" value={n(stability.mean)} />
          <Metric label="Min / max" value={stability.min === null ? "—" : `${stability.min} / ${stability.max}`} />
          <Metric label="Result flips" value={String(stability.flips.length)} tone={stability.flips.length ? "warn" : "ok"} />
        </div>
      </section>

      <section className="eval-section">
        <h3>Supplemental lifecycle evaluation</h3>
        <div className="metric-grid">
          <Metric label="Cases passed" value={ratio(supplemental.casesPassed, supplemental.casesTotal)} tone="ok" />
          <Metric label="Pass rate" value={pct(supplemental.passRate)} />
          <Metric label="Cases failed" value={n(supplemental.casesFailed)} />
        </div>
      </section>

      <section className="eval-section">
        <h3>Retrieval quality</h3>
        <div className="metric-grid">
          <Metric label="Required retrieval recall" value={pct(official.layerB.requiredRetrievalRecall)} />
          <Metric label="Average tool calls" value={official.layerB.avgToolCalls === null ? "—" : official.layerB.avgToolCalls.toFixed(2)} />
          <Metric label="Total tool calls" value={n(official.layerB.totalToolCalls)} />
          <Metric label="Unnecessary calls" value={n(official.layerB.unnecessaryToolCalls)} />
          <Metric label="Duplicate calls" value={n(official.layerB.duplicateToolCalls)} />
          <Metric label="Tool failures" value={n(official.layerB.toolFailures)} />
        </div>
      </section>

      <section className="eval-section">
        <h3>Safety</h3>
        <div className="metric-grid">
          <Metric label="Recommended actions" value={n(official.safety.totalRecommended)} />
          <Metric label="Policy blocked" value={n(official.safety.totalPolicyBlocked)} />
          <Metric label="Executed" value={n(official.safety.totalExecuted)} />
          <Metric label="External executions" value={n(official.safety.externalExecutions)} tone={official.safety.externalExecutions ? "warn" : "ok"} />
          <Metric label="Injection escalations" value={n(official.safety.injectionEscalations)} tone={official.safety.injectionEscalations ? "warn" : "ok"} />
          <Metric label="Must-not-execute violations" value={n(official.layerC.mustNotExecuteViolations)} tone={official.layerC.mustNotExecuteViolations ? "warn" : "ok"} />
        </div>
      </section>

      {architecture && (
        <section className="eval-section">
          <h3>Architecture comparison</h3>
          <p className="section-lead">Bounded retrieval versus retrieving everything, on the same frozen cases.</p>
          <div className="arch-grid">
            <ArmColumn title="Bounded retrieval" arm={architecture.bounded} />
            <ArmColumn title="Retrieve all" arm={architecture.retrieveAll} />
          </div>
        </section>
      )}

      {s.failureProgression.length > 0 && (
        <section className="eval-section">
          <h3>Failure progression</h3>
          <ol className="progression">
            {s.failureProgression.map((p) => (
              <li key={p.label}>
                <span className="progression-label">{p.label}</span>
                <span className="progression-value">{ratio(p.casesPassed, p.casesTotal)}</span>
                {p.generatedAt && <span className="progression-date">{new Date(p.generatedAt).toLocaleDateString()}</span>}
                {p.note && <span className="progression-note">{p.note}</span>}
              </li>
            ))}
          </ol>
          {s.remainingFailures.length > 0 && (
            <ul className="failure-list">
              {s.remainingFailures.map((f, i) => (
                <li key={f.id ?? i}>
                  <b>{f.name ?? f.id ?? "Case"}</b>
                  {f.category && <span className="tag tag-muted">{f.category}</span>}
                  {f.expected && (
                    <span>
                      expected <em>{f.expected}</em>
                      {f.actual ? (
                        <>
                          , observed <em>{f.actual}</em>
                        </>
                      ) : null}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="eval-section proof-grid">
        <div className="proof-card">
          <h3>What this proves</h3>
          <ul>
            <li>Semantic interpretation of commitments, owners and dates is measured against frozen ground truth.</li>
            <li>Retrieval is bounded and evidence-linked rather than exhaustive.</li>
            <li>Reconciliation classifications are scored per case, not sampled.</li>
            <li>Safety behaviour — blocked actions, external execution and injection escalation — is counted explicitly.</li>
            <li>Results are stable across repeated runs of the same frozen set.</li>
          </ul>
        </div>
        <div className="proof-card">
          <h3>What this does not prove</h3>
          <ul>
            <li>It is not a measurement of production customer outcomes.</li>
            <li>Scenarios are synthetic, so they do not capture the full messiness of live data.</li>
            <li>It does not measure long-horizon behaviour across weeks of account history.</li>
            <li>It does not establish ROI; any business figure elsewhere is a modelled target.</li>
          </ul>
        </div>
      </section>

      <p className="eval-sources">Source artifacts: {s.sources.join(", ")}</p>
    </>
  );
}

export function EvaluationScreen() {
  const { summary, loading, error, refresh } = useEvaluationSummary();

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Evaluation</h1>
          <p className="page-subtitle">Measured system evidence, read from committed evaluation artifacts.</p>
        </div>
        <span className="page-head-meta">
          <ShieldCheck size={14} aria-hidden /> Never re-run on page load
        </span>
      </header>

      {loading ? (
        <Skeleton rows={4} height={110} />
      ) : error != null ? (
        <ErrorNotice error={error} onRetry={() => void refresh()} />
      ) : !summary ? (
        <EmptyState title="No evaluation results are available." hint="The evaluation artifacts could not be read from this environment." />
      ) : (
        <Report s={summary} />
      )}
    </>
  );
}
