import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, FileSearch, Lock, ScrollText, ShieldCheck, Split } from "lucide-react";
import { PublicLayout } from "./PublicLayout";
import { useEvaluationSummary } from "../hooks";
import { PILOT_QUOTES } from "../content/testimonials";
import { Skeleton } from "../components/States";

const PIPELINE = [
  "Interaction",
  "Understanding",
  "Evidence retrieval",
  "State reconciliation",
  "Execution gaps",
  "Policy",
  "Human approval",
  "Deterministic execution",
];

const TRUST = [
  { icon: FileSearch, title: "Evidence-backed", body: "Every finding points at the span of conversation or record it came from." },
  { icon: Split, title: "Source-aware", body: "Each fact has an authoritative source; Tubo never averages contradictory ones." },
  { icon: CheckCircle2, title: "Human-approved", body: "Consequential actions wait for a person. Approval and execution are separate." },
  { icon: Lock, title: "Fail-closed", body: "Missing or unverifiable context blocks the action instead of guessing." },
  { icon: ScrollText, title: "Auditable", body: "Inputs, retrieval, policy decisions and approvals are all recorded." },
];

const MODELLED = [
  "Less cross-tool checking before a customer conversation",
  "Faster time to a review-ready account state",
  "Fewer duplicate follow-ups sent to the same customer",
  "Fewer missed execution gaps after a call",
  "Safer consequential CRM changes",
];

function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function LandingPage() {
  const { summary, loading } = useEvaluationSummary();
  const o = summary?.official;

  return (
    <PublicLayout>
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-kicker">Tubo — Revenue Execution OS</span>
          <h1>Turn customer conversations into trusted operational state.</h1>
          <p>
            Tubo reconciles what customers said with CRM, email, tasks and commercial state before consequential revenue
            actions happen.
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary" to="/app/command-center">
              Open Live System <ArrowRight size={15} aria-hidden />
            </Link>
            <Link className="btn btn-secondary" to="/case-study">
              Read Case Study
            </Link>
          </div>
        </div>

        {/* Live-product composition built from the same components the app uses. */}
        <div className="hero-product" aria-hidden="true">
          <div className="hero-card">
            <div className="hero-card-head">
              <span className="sev-pill sev-high">high</span>
              <span className="hero-account">Northwind Logistics</span>
              <span className="finding-type">commercial crm mismatch</span>
            </div>
            <p className="queue-issue">CRM shows Closed Won; the customer asked to delay signature by two weeks.</p>
            <div className="queue-evidence">
              <span className="tag tag-evidence">Transcript span</span>
              <span className="tag tag-evidence">HubSpot deal</span>
              <span className="tag tag-warn">Commercial unverified</span>
            </div>
          </div>
          <div className="hero-card hero-card-approval">
            <div className="hero-card-head">
              <span className="tag tag-pending">Awaiting approval</span>
            </div>
            <div className="hero-approval-row">
              <span>Update deal stage → Contract sent</span>
              <span className="tag tag-muted">Risk: medium</span>
            </div>
            <div className="hero-approval-actions">
              <span className="btn btn-ghost btn-sm">Reject</span>
              <span className="btn btn-secondary btn-sm">Edit</span>
              <span className="btn btn-primary btn-sm">Approve</span>
            </div>
          </div>
        </div>
      </section>

      <section className="public-section">
        <h2>Customer reality changes faster than operational systems.</h2>
        <p className="section-lead">
          A customer says something on a call. The CRM still says something else. An email answered half of it. A task
          was never closed. Commercial state was never verified. Within a day, four systems disagree — and someone makes
          a decision from whichever one they happened to open.
        </p>
      </section>

      <section className="public-section">
        <h2>How the system works</h2>
        <ol className="pipeline">
          {PIPELINE.map((step, i) => (
            <li key={step}>
              <span className="pipeline-index">{i + 1}</span>
              <span className="pipeline-label">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="public-section">
        <h2>Built to be trusted</h2>
        <div className="trust-grid">
          {TRUST.map((t) => (
            <div className="trust-card" key={t.title}>
              <t.icon size={18} aria-hidden />
              <h3>{t.title}</h3>
              <p>{t.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="public-section">
        <div className="section-head-row">
          <h2>System evaluation</h2>
          <Link className="section-link" to="/evaluation">
            See full evaluation <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
        <p className="section-lead">
          Frozen synthetic scenarios that test semantic interpretation, retrieval, reconciliation and safety. These are
          system measurements, not customer outcomes.
        </p>
        {loading ? (
          <Skeleton rows={2} height={92} />
        ) : !summary ? (
          <p className="section-lead">Evaluation results are unavailable in this environment.</p>
        ) : (
          <div className="metric-grid">
            <div className="metric metric-ok">
              <span className="metric-value">
                {o?.casesPassed ?? "—"}/{o?.casesTotal ?? "—"}
              </span>
              <span className="metric-label">Frozen evaluation cases passed</span>
            </div>
            <div className="metric">
              <span className="metric-value">{summary.stability.runs.length ? summary.stability.runs.join(" · ") : "—"}</span>
              <span className="metric-label">Stability across repeated runs</span>
            </div>
            <div className="metric">
              <span className="metric-value">
                {summary.supplemental.casesPassed ?? "—"}/{summary.supplemental.casesTotal ?? "—"}
              </span>
              <span className="metric-label">Lifecycle evaluation cases</span>
            </div>
            <div className="metric">
              <span className="metric-value">{pct(o?.layerB.requiredRetrievalRecall ?? null)}</span>
              <span className="metric-label">Required retrieval recall</span>
            </div>
            <div className="metric metric-ok">
              <span className="metric-value">{o?.safety.externalExecutions ?? "—"}</span>
              <span className="metric-label">Unsafe external executions</span>
            </div>
            <div className="metric metric-ok">
              <span className="metric-value">{o?.layerC.mustNotExecuteViolations ?? "—"}</span>
              <span className="metric-label">Approval bypasses</span>
            </div>
            <div className="metric metric-ok">
              <span className="metric-value">{o?.safety.injectionEscalations ?? "—"}</span>
              <span className="metric-label">Injection escalations</span>
            </div>
          </div>
        )}
      </section>

      <section className="public-section">
        <div className="section-head-row">
          <h2>Modelled operational impact</h2>
          <span className="label-flag">Modelled target · hypothesis</span>
        </div>
        <p className="section-lead">
          These are pilot targets to be tested with real usage, not measured production outcomes.
        </p>
        <ul className="value-list">
          {MODELLED.map((m) => (
            <li key={m}>
              <ShieldCheck size={15} aria-hidden /> {m}
            </li>
          ))}
        </ul>
      </section>

      <section className="public-section">
        <h2>Pilot user feedback</h2>
        {PILOT_QUOTES.length === 0 ? (
          <p className="section-lead">
            Feedback from the pilot user is being collected from real usage and will be published verbatim.
          </p>
        ) : (
          <div className="quote-grid">
            {PILOT_QUOTES.map((q) => (
              <figure className="quote-card" key={q.quote}>
                <blockquote className="quote-text">{q.quote}</blockquote>
                <figcaption className="quote-attribution">
                  <span className="quote-avatar" aria-hidden="true">{initials(q.author)}</span>
                  <span className="quote-person">
                    <b>{q.author}</b>
                    <span>{[q.role, q.channel, fmtDate(q.date)].filter(Boolean).join(" · ")}</span>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      <section className="public-cta">
        <h2>See the reconciled state for yourself.</h2>
        <Link className="btn btn-primary" to="/app/command-center">
          Open Live System <ArrowRight size={15} aria-hidden />
        </Link>
      </section>
    </PublicLayout>
  );
}
