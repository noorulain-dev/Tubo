import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, FileSearch, Lock, ScrollText, Split } from "lucide-react";
import { PublicLayout } from "./PublicLayout";

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

export function LandingPage() {
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
          <h2>Measured, not assumed</h2>
        </div>
        <p className="section-lead">
          Tubo is evaluated against a frozen suite of real interaction cases, and its workflow is grounded in a real
          operator's experience.
        </p>
        <div className="cta-actions">
          <Link className="btn btn-secondary" to="/evaluation">
            View Evaluation <ArrowRight size={14} aria-hidden />
          </Link>
          <Link className="btn btn-secondary" to="/case-study">
            Read Case Study <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
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
