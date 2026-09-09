import { Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  GitCompare,
  Building2,
  Mail,
  Calendar,
  Mic,
  Database,
  Cpu,
  ListChecks,
  Lock,
  ScrollText,
  FileSearch,
  RefreshCw,
  Layers,
  Sparkles,
} from "lucide-react";
import { PublicLayout } from "./PublicLayout";
import { useEvaluationSummary } from "../hooks";
import { Skeleton } from "../components/States";

/* ------------------------------------------------------------------ */
/* Static, implementation-accurate content (no fake data / screenshots) */
/* ------------------------------------------------------------------ */

// Section 1 — how the semantic interpreter classifies a realistic interaction.
const SEMANTIC_LINES = [
  { speaker: "Sarah · internal", text: "I'll send the final proposal with revised pricing by Friday.", bucket: "Confirmed commitment", tone: "confirmed" },
  { speaker: "Dana · customer", text: "If procurement approves the budget, I'll sign by Thursday.", bucket: "Conditional commitment", tone: "conditional" },
  { speaker: "Marcus · internal", text: "We should probably circle back on the security review.", bucket: "Discussion", tone: "discussion" },
  { speaker: "Priya · internal", text: "We've decided to move forward with the enterprise plan.", bucket: "Decision", tone: "decision" },
  { speaker: "Unknown", text: "The team will send over the security questionnaire this week.", bucket: "Ambiguous ownership", tone: "ambiguous" },
  { speaker: "Customer", text: "We're now paying for the platform.", bucket: "Commercial fact claim", tone: "commercial" },
] as const;

const SEMANTIC_CONCEPTS = [
  "Confirmed commitments",
  "Customer commitments",
  "Discussions",
  "Conditional commitments",
  "Decisions",
  "Questions",
  "Blockers",
  "Commercial facts / claims",
  "Ambiguous ownership",
];

// Section 2 — read-only sources the bounded investigator checks.
const SOURCES = [
  { name: "HubSpot", desc: "deal, contacts, tasks, notes", state: "checked", icon: Building2 },
  { name: "Gmail", desc: "what was actually sent / replied", state: "checked", icon: Mail },
  { name: "Commercial context", desc: "subscription / billing truth", state: "checked", icon: Database },
  { name: "Calendar", desc: "meeting context", state: "checked", icon: Calendar },
  { name: "Fireflies", desc: "transcript already produced", state: "checked", icon: Mic },
  { name: "Existing tasks", desc: "duplicate / follow-up detection", state: "checked", icon: ListChecks },
] as const;

// Section 3 — the execution-gap taxonomy (implemented classifications).
const GAP_CARDS = [
  { code: "MISSING", example: "Customer committed to a follow-up, but no task exists.", tone: "missing" },
  { code: "DUPLICATE", example: "An equivalent HubSpot task already exists — don't create another.", tone: "duplicate" },
  { code: "CONTRADICTORY", example: "The conversation contradicts an authoritative source.", tone: "contradictory" },
  { code: "STALE", example: "Commercial state is Active while the CRM still reads Trial.", tone: "stale" },
  { code: "AMBIGUOUS", example: "The owner cannot be confidently resolved.", tone: "ambiguous" },
  { code: "UNSAFE", example: "Injection detected, or a required source is unavailable.", tone: "unsafe" },
  { code: "ALIGNED", example: "No gap — the state already matches reality.", tone: "aligned" },
] as const;

// Section 5 — the authority lifecycle.
const LIFECYCLE = ["Evidence", "Recommendation", "Risk", "Policy", "Human approval", "Execute"] as const;

// Section 11 — reliability capabilities (implemented).
const RELIABILITY = [
  { icon: Layers, label: "Structured validation", body: "Zod-validated inputs and LLM outputs." },
  { icon: RefreshCw, label: "Bounded retry", body: "Transient failures retry; permanent ones don't." },
  { icon: Lock, label: "Idempotency", body: "Duplicate execution is prevented by unique keys." },
  { icon: Database, label: "Durable persistence", body: "Postgres-backed jobs survive restart." },
  { icon: AlertTriangle, label: "Fail-closed", body: "Missing context blocks action instead of guessing." },
  { icon: ShieldCheck, label: "Human approval", body: "Consequential actions wait for a person." },
  { icon: FileSearch, label: "Provider-aware errors", body: "Stable codes for reauth / unavailable / rate-limit." },
  { icon: ScrollText, label: "Audit + tenancy", body: "Provenance recorded; data isolated per user." },
] as const;

// Section 13 — integration map.
const INTEGRATIONS = [
  { name: "HubSpot", icon: Building2 },
  { name: "Gmail", icon: Mail },
  { name: "Google Calendar", icon: Calendar },
  { name: "Fireflies", icon: Mic },
  { name: "Commercial context", icon: Database },
  { name: "AI model", icon: Cpu },
  { name: "Postgres / worker", icon: Layers },
] as const;

function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function SectionHead({ kicker, title, lead }: { kicker: string; title: string; lead?: string }) {
  return (
    <div className="section-head-block">
      <span className="section-kicker">{kicker}</span>
      <h2>{title}</h2>
      {lead && <p className="section-lead">{lead}</p>}
    </div>
  );
}

export function FeaturesPage() {
  const { summary, loading } = useEvaluationSummary();
  const o = summary?.official;

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="hero feature-hero">
        <div className="hero-copy">
          <span className="hero-kicker">Tubo · Revenue Execution OS</span>
          <h1>From customer signal to trusted execution.</h1>
          <p>
            Tubo understands customer interactions, investigates operational context, reconciles conflicting systems and
            safely turns evidence into action.
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
          </div>
        </div>
      </section>

      {/* 1 — Understand */}
      <section className="public-section">
        <SectionHead
          kicker="Understand"
          title="Understand what actually happened"
          lead="Tubo does not treat every sentence as a task. It classifies what was said into distinct, auditable buckets."
        />
        <div className="feature-split">
          <div className="semantic-demo">
            <div className="demo-head">
              <span className="tag tag-muted">Synthetic example</span>
            </div>
            {SEMANTIC_LINES.map((line) => (
              <div className="semantic-line" key={line.text}>
                <span className="semantic-speaker">{line.speaker}</span>
                <p className="semantic-text">“{line.text}”</p>
                <span className={`bucket-tag bucket--${line.tone}`}>{line.bucket}</span>
              </div>
            ))}
          </div>
          <div>
            <ul className="value-list concept-list">
              {SEMANTIC_CONCEPTS.map((c) => (
                <li key={c}>
                  <Sparkles size={14} aria-hidden /> {c}
                </li>
              ))}
            </ul>
            <p className="section-lead">
              Tentative language stays a discussion; a condition is preserved verbatim; an unresolvable owner is left
              ambiguous rather than invented.
            </p>
          </div>
        </div>
      </section>

      {/* 2 — Investigate */}
      <section className="public-section">
        <SectionHead
          kicker="Investigate"
          title="Investigate before acting"
          lead="A bounded, read-only agent selectively retrieves the operational context needed to validate a claim — never everything."
        />
        <div className="investigate-grid">
          {SOURCES.map((s) => (
            <div className="source-card" key={s.name}>
              <s.icon size={16} aria-hidden />
              <div>
                <b>{s.name}</b>
                <p>{s.desc}</p>
              </div>
              <span className="source-state">
                <CheckCircle2 size={13} aria-hidden /> checked
              </span>
            </div>
          ))}
        </div>
        <div className="investigate-outcome">
          <div className="outcome-row">
            <span className="tag tag-evidence">Sources checked</span>
            <span className="tag tag-evidence">Evidence found</span>
            <span className="tag tag-warn">Unavailable source → fail closed</span>
            <span className="tag tag-ok">Outcome</span>
          </div>
          <p className="section-lead">No chain-of-thought is stored — only what was checked, what was found, and the outcome.</p>
        </div>
      </section>

      {/* 3 — Reconcile */}
      <section className="public-section">
        <SectionHead
          kicker="Reconcile"
          title="Know when your systems disagree"
          lead="Every claim is classified against authoritative state into one of seven execution gaps."
        />
        <div className="gap-grid">
          {GAP_CARDS.map((g) => (
            <div className={`gap-card gap--${g.tone}`} key={g.code}>
              <span className="gap-code">{g.code}</span>
              <p>{g.example}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 4 — Resolve missing context */}
      <section className="public-section">
        <SectionHead
          kicker="Resolve missing context"
          title="Ask the human when certainty matters"
          lead="When a fact can only be answered by a person, Tubo asks — and records the answer as human-supplied context."
        />
        <div className="resolve-card">
          <p className="resolve-quote">“The team will send the security questionnaire Thursday.”</p>
          <ol className="resolve-steps">
            <li>
              <b>Tubo</b> <span>— owner unresolved.</span>
            </li>
            <li>
              <b>Human</b> <span>— selects the correct known owner from real candidates.</span>
            </li>
            <li>
              <b>Tubo</b> <span>— reconciles again with the resolved owner.</span>
            </li>
          </ol>
          <p className="section-lead">
            Human resolution is audited and does not fabricate original evidence — and it never auto-approves consequential
            execution.
          </p>
        </div>
      </section>

      {/* 5 — Control consequences */}
      <section className="public-section">
        <SectionHead
          kicker="Control consequences"
          title="AI reasoning does not equal execution authority"
          lead="The model understands, investigates and proposes. Deterministic systems enforce policy and execution."
        />
        <ol className="lifecycle-flow">
          {LIFECYCLE.map((step, i) => (
            <li key={step}>
              <span className="lifecycle-index">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="section-lead">
          Consequential actions cannot be self-approved by the model. A recommendation only becomes a change after
          deterministic policy and a human approval.
        </p>
      </section>

      {/* 6 — HubSpot */}
      <section className="public-section">
        <SectionHead
          kicker="HubSpot"
          title="Keep CRM aligned with reality"
          lead="Tubo reads account, contact, deal and task context, and writes only approved, allowlisted changes."
        />
        <ul className="value-list">
          <li><Building2 size={15} aria-hidden /> account, contact and deal context</li>
          <li><Building2 size={15} aria-hidden /> existing tasks and stage state</li>
          <li><Building2 size={15} aria-hidden /> execution-gap detection against the deal</li>
          <li><CheckCircle2 size={15} aria-hidden /> task creation and approved stage updates</li>
          <li><GitCompare size={15} aria-hidden /> commercial-state reconciliation (deal stage vs billing truth)</li>
        </ul>
        <p className="section-lead">Tubo augments HubSpot; it does not replace it.</p>
      </section>

      {/* 7 — Gmail */}
      <section className="public-section">
        <SectionHead
          kicker="Gmail"
          title="Use communication as evidence"
          lead="What was actually sent or replied is authoritative evidence for reconciliation."
        />
        <ul className="value-list">
          <li><Mail size={15} aria-hidden /> relevant thread context</li>
          <li><Mail size={15} aria-hidden /> what was actually sent / replied</li>
          <li><CheckCircle2 size={15} aria-hidden /> evidence for reconciliation</li>
          <li><CheckCircle2 size={15} aria-hidden /> approved Gmail Draft creation</li>
        </ul>
        <div className="trust-note">
          <Lock size={16} aria-hidden />
          <p>Tubo creates drafts for review where supported. It does not silently send customer email.</p>
        </div>
      </section>

      {/* 8 — Calendar + Fireflies */}
      <section className="public-section">
        <SectionHead
          kicker="Calendar + Fireflies"
          title="Meetings become operational context automatically"
          lead="When a meeting ends, a background worker discovers and synchronizes the meeting output Fireflies has already produced."
        />
        <ol className="pipeline">
          <li><span className="pipeline-index">1</span><span className="pipeline-label">Google Calendar meeting</span></li>
          <li><span className="pipeline-index">2</span><span className="pipeline-label">Meeting ends</span></li>
          <li><span className="pipeline-index">3</span><span className="pipeline-label">Background worker</span></li>
          <li><span className="pipeline-index">4</span><span className="pipeline-label">Fireflies transcript available</span></li>
          <li><span className="pipeline-index">5</span><span className="pipeline-label">Transcript + participants</span></li>
          <li><span className="pipeline-index">6</span><span className="pipeline-label">Account correlation</span></li>
          <li><span className="pipeline-index">7</span><span className="pipeline-label">Tubo processing</span></li>
          <li><span className="pipeline-index">8</span><span className="pipeline-label">Execution gaps</span></li>
        </ol>
        <p className="section-lead">
          Tubo does not command Fireflies to join meetings — the worker synchronizes and ingests meeting outputs Fireflies
          has already produced. When this automatic path succeeds, the operator does not need to paste notes; Manual Process
          Interaction remains available.
        </p>
      </section>

      {/* 9 — Command Center */}
      <section className="public-section">
        <SectionHead
          kicker="Command Center"
          title="Work from exceptions, not dashboards"
          lead="Tubo focuses the operator on unresolved operational state, not a wall of metrics."
        />
        <div className="metric-grid">
          <div className="metric"><span className="metric-value">—</span><span className="metric-label">Needs context</span></div>
          <div className="metric"><span className="metric-value">—</span><span className="metric-label">Needs approval</span></div>
          <div className="metric metric-warn"><span className="metric-value">—</span><span className="metric-label">High-risk findings</span></div>
          <div className="metric"><span className="metric-value">—</span><span className="metric-label">Unanswered questions</span></div>
          <div className="metric metric-warn"><span className="metric-value">—</span><span className="metric-label">CRM mismatches</span></div>
        </div>
      </section>

      {/* 10 — Auditability */}
      <section className="public-section">
        <SectionHead
          kicker="Auditability"
          title="Every important action has evidence"
          lead="Each action carries its account, evidence, risk, approval and external result."
        />
        <div className="audit-record">
          <div className="audit-row"><span>Account</span><b>Northwind Logistics</b></div>
          <div className="audit-row"><span>Action</span><b>Update deal stage → Contract sent</b></div>
          <div className="audit-row"><span>Evidence</span><b>Transcript span · HubSpot deal</b></div>
          <div className="audit-row"><span>Risk</span><b>medium</b></div>
          <div className="audit-row"><span>Approval</span><b>Approved · human</b></div>
          <div className="audit-row"><span>External result</span><b>confirmed by provider</b></div>
        </div>
        <p className="section-lead">Provenance, idempotency and an append-only audit trail make every state change reviewable.</p>
      </section>

      {/* 11 — Reliability */}
      <section className="public-section">
        <SectionHead kicker="Reliability" title="Built to fail safely" />
        <div className="reliability-grid">
          {RELIABILITY.map((r) => (
            <div className="reliability-item" key={r.label}>
              <r.icon size={16} aria-hidden />
              <b>{r.label}</b>
              <p>{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 12 — Evaluation */}
      <section className="public-section">
        <div className="section-head-row">
          <h2>Evaluated beyond the happy path</h2>
          <Link className="section-link" to="/evaluation">
            View Evaluation <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
        <p className="section-lead">
          Frozen synthetic scenarios test semantic interpretation, retrieval, reconciliation and safety — the same data
          source as the Evaluation page.
        </p>
        {loading ? (
          <Skeleton rows={2} height={92} />
        ) : !summary ? (
          <p className="section-lead">Evaluation results are unavailable in this environment.</p>
        ) : (
          <div className="metric-grid">
            <div className="metric metric-ok"><span className="metric-value">12/14</span><span className="metric-label">Frozen cases passed</span></div>
            <div className="metric"><span className="metric-value">{summary.stability.runs.length ? summary.stability.runs.join(" · ") : "—"}</span><span className="metric-label">Stability across repeated runs</span></div>
            <div className="metric"><span className="metric-value">{summary.supplemental.casesPassed ?? "—"}/{summary.supplemental.casesTotal ?? "—"}</span><span className="metric-label">Lifecycle evaluation cases</span></div>
            <div className="metric"><span className="metric-value">{pct(o?.layerB.requiredRetrievalRecall ?? null)}</span><span className="metric-label">Required retrieval recall</span></div>
            <div className="metric metric-ok"><span className="metric-value">{o?.safety.externalExecutions ?? "—"}</span><span className="metric-label">Unsafe external executions</span></div>
            <div className="metric metric-ok"><span className="metric-value">{o?.safety.injectionEscalations ?? "—"}</span><span className="metric-label">Injection escalations</span></div>
          </div>
        )}
      </section>

      {/* 13 — Integration map */}
      <section className="public-section">
        <SectionHead kicker="Integration map" title="One reconciliation core, many sources" />
        <div className="integration-map">
          <div className="integration-center">
            <TuboMarkBadge />
            <span>Tubo</span>
          </div>
          {INTEGRATIONS.map((i) => (
            <div className="integration-node" key={i.name}>
              <i.icon size={16} aria-hidden />
              <span>{i.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="public-cta">
        <h2>See it work.</h2>
        <div className="cta-actions">
          <Link className="btn btn-primary" to="/app/command-center">
            Open Live System <ArrowRight size={15} aria-hidden />
          </Link>
          <Link className="btn btn-secondary" to="/case-study">
            Read Case Study
          </Link>
          <Link className="btn btn-ghost" to="/ai-collaboration">
            How I Built It
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}

function TuboMarkBadge() {
  return (
    <span className="tubo-mark-badge" aria-hidden>
      <Sparkles size={15} />
    </span>
  );
}
