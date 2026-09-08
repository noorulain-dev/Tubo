import { useState } from "react";
import { api } from "../api";
import { Button, Card, EmptyState, Section, SeverityBadge, Spinner, TestDataBadge } from "../components";
import { useAccountDetail } from "../hooks";
import type { Finding, InvestigationOutcome, InvestigationResult } from "../types";

function outcomeLabel(o: InvestigationOutcome): string {
  return { confirmed: "Confirmed", rejected: "Rejected", ambiguous: "Ambiguous", missing_context: "Missing context" }[o];
}

function outcomeClass(o: InvestigationOutcome): string {
  return { confirmed: "pill-live", rejected: "pill-failed", ambiguous: "pill-created", missing_context: "pill-sample" }[o] ?? "pill";
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff)) return "—";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function FindingRow({ finding, onInvestigate }: { finding: Finding; onInvestigate: () => void }) {
  return (
    <div className="finding-row">
      <div className="finding-main">
        <div className="finding-title">
          <SeverityBadge value={finding.severity} /> {finding.title}
        </div>
        {finding.description && <div className="helper">{finding.description}</div>}
      </div>
      <div className="finding-actions">
        {finding.needsInvestigation && (
          <Button variant="secondary" onClick={onInvestigate}>Investigate</Button>
        )}
      </div>
    </div>
  );
}

function InvestigationPanel({ result }: { result: InvestigationResult }) {
  return (
    <div className="investigation">
      <div className="investigation-head">
        <span className={`pill ${outcomeClass(result.outcome)}`}>{outcomeLabel(result.outcome)}</span>
        <span className="helper">{result.trace.length} tool call(s)</span>
      </div>
      <table className="table">
        <thead>
          <tr><th>Checked</th><th>Reason</th><th>Result</th></tr>
        </thead>
        <tbody>
          {result.trace.map((s, i) => (
            <tr key={i}>
              <td>{s.tool.replace(/_/g, " ")}</td>
              <td>{s.reasonCategory.replace(/_/g, " ")}</td>
              <td>{s.factualResult}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AccountScreen({ accountId }: { accountId: string }) {
  const { detail, loading, error, refresh } = useAccountDetail(accountId);
  const [investigating, setInvestigating] = useState(false);
  const [investigation, setInvestigation] = useState<InvestigationResult | null>(null);
  const [acting, setActing] = useState(false);

  if (loading) return <div className="loading-block"><Spinner /> Loading account…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!detail) return <EmptyState title="Account not found" />;

  const s = detail.snapshot;
  const name = s.identity?.name ?? accountId;
  const isAssessment = accountId.startsWith("[ASSESSMENT]") || (name.includes("[ASSESSMENT]"));

  async function markReviewed() {
    await api.markReviewed(accountId);
    await refresh();
  }

  async function investigate(findingId: string) {
    setInvestigating(true);
    try {
      setInvestigation(await api.investigateFinding(findingId));
      await refresh();
    } finally {
      setInvestigating(false);
    }
  }

  async function planDecision(planId: string, actionId: string, decision: "approve" | "reject") {
    setActing(true);
    try {
      await api.applyPlanDecision(planId, actionId, decision);
      await refresh();
    } finally {
      setActing(false);
    }
  }

  return (
    <>
      <div className="main-header">
        <div>
          <div className="page-title">{name}</div>
          <div className="page-subtitle">
            CRM stage: <strong>{s.stage ?? "—"}</strong> · Commercial: <strong>{s.commercial?.status ?? "—"}</strong>
            {" · "}Last event {relTime(s.recentEvents?.[0]?.occurredAt ?? null)}
          </div>
        </div>
        <div className="header-actions">
          {isAssessment && <TestDataBadge />}
          <Button variant="ghost" onClick={() => void refresh()}>Refresh</Button>
          <Button variant="secondary" onClick={() => void markReviewed()}>Mark reviewed</Button>
        </div>
      </div>

      <Section title="What changed since last review">
        <Card>
          {detail.lastReviewedAt ? (
            <div>
              <div className="helper">Last reviewed {relTime(detail.lastReviewedAt)} · {detail.changes.eventsSince} event(s) since.</div>
              {detail.changes.stage && <div>Stage: {detail.changes.stage.before ?? "—"} → {detail.changes.stage.after}</div>}
              {detail.changes.commercial && <div>Commercial: {detail.changes.commercial.before ?? "—"} → {detail.changes.commercial.after}</div>}
              {detail.changes.newCommitments.length > 0 && <div>New commitments: {detail.changes.newCommitments.join(", ")}</div>}
              {detail.changes.resolvedCommitments.length > 0 && <div>Resolved commitments: {detail.changes.resolvedCommitments.join(", ")}</div>}
              {detail.changes.answeredQuestions.length > 0 && <div>Answered questions: {detail.changes.answeredQuestions.join(", ")}</div>}
              {detail.changes.newBlockers.length > 0 && <div>New blockers: {detail.changes.newBlockers.join(", ")}</div>}
              {!detail.changes.stage && !detail.changes.commercial && detail.changes.eventsSince === 0 && <div>No changes since last review.</div>}
            </div>
          ) : (
            <div className="helper">Not reviewed yet — everything is new since first view.</div>
          )}
        </Card>
      </Section>

      <Section title="CRM vs commercial state">
        <Card>
          <div className="kv"><span>CRM stage</span><strong>{s.stage ?? "—"}</strong></div>
          <div className="kv"><span>Commercial state</span><strong>{s.commercial?.status ?? "—"}</strong></div>
          {s.commercial?.provenance && <div className="helper">Commercial provenance: {s.commercial.provenance}</div>}
          {s.unavailableSources.length > 0 && <div className="alert alert-warn">Unavailable sources: {s.unavailableSources.join(", ")}</div>}
        </Card>
      </Section>

      <Section title="Open commitments">
        <Card>
          {s.commitments.length === 0 ? <EmptyState title="No commitments" /> : (
            <table className="table">
              <thead><tr><th>Commitment</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
              <tbody>
                {s.commitments.map((c) => (
                  <tr key={c.id}>
                    <td>{c.description}</td>
                    <td>{c.owner ?? (c.ownerResolution === "ambiguous" ? "ambiguous" : "—")}</td>
                    <td>{c.dueDate ? relTime(c.dueDate) : (c.dueDateResolution === "ambiguous" ? "ambiguous" : "—")}</td>
                    <td><span className="pill">{c.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </Section>

      <Section title="Customer questions">
        <Card>
          {s.questions.length === 0 ? <EmptyState title="No questions" /> : (
            <ul className="list">
              {s.questions.map((q) => (
                <li key={q.id}>
                  <strong>{q.question}</strong>
                  <span className={`pill ${q.status === "open" ? "pill-created" : ""}`}>{q.status}</span>
                  {q.answer && <div className="helper">Answer: {q.answer.text}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <Section title="Blockers">
        <Card>
          {s.blockers.length === 0 ? <EmptyState title="No blockers" /> : (
            <ul className="list">{s.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
          )}
        </Card>
      </Section>

      <Section title="Execution findings">
        <Card>
          {detail.findings.length === 0 ? <EmptyState title="No findings" /> : (
            <div>
              {detail.findings.filter((f) => f.status === "open").map((f) => (
                <FindingRow key={f.findingId} finding={f} onInvestigate={() => void investigate(f.findingId)} />
              ))}
            </div>
          )}
        </Card>
      </Section>

      <Section title="AI investigation">
        <Card>
          {investigating ? <div className="loading-block"><Spinner /> Investigating…</div> : investigation ? <InvestigationPanel result={investigation} /> : detail.latestInvestigation ? <InvestigationPanel result={detail.latestInvestigation} /> : <EmptyState title="No investigation yet" hint="Investigate a finding to confirm or reject it." />}
        </Card>
      </Section>

      <Section title="Execution plan">
        <Card>
          {detail.plans.length === 0 ? <EmptyState title="No execution plan" /> : (
            detail.plans.map((p) => (
              <div key={p.planId} className="plan">
                <div className="plan-head"><strong>{p.objective}</strong></div>
                {p.evidence.length > 0 && <div className="helper">Evidence: {p.evidence.join(" · ")}</div>}
                <table className="table">
                  <thead><tr><th>Action</th><th>Risk</th><th>Policy</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {p.actions.map((a) => (
                      <tr key={a.actionId}>
                        <td>{a.action.type}: {String((a.action.payload as Record<string, unknown> | undefined)?.title ?? (a.action.payload as Record<string, unknown> | undefined)?.owner ?? a.action.target ?? "")}</td>
                        <td><SeverityBadge value={a.policy.risk} /></td>
                        <td>{a.policy.action.replace(/_/g, " ")}</td>
                        <td><span className="pill">{a.status}</span></td>
                        <td>
                          {a.status === "pending_approval" || a.status === "ready" ? (
                            <Button variant="secondary" disabled={acting} onClick={() => void planDecision(p.planId, a.actionId, "approve")}>Approve</Button>
                          ) : null}
                          {a.status === "pending_approval" || a.status === "ready" ? (
                            <Button variant="ghost" disabled={acting} onClick={() => void planDecision(p.planId, a.actionId, "reject")}>Reject</Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </Card>
      </Section>

      <Section title="Recent activity">
        <Card>
          {detail.recentEvents.length === 0 ? <EmptyState title="No activity" /> : (
            <ul className="list">
              {detail.recentEvents.slice(0, 20).map((e, i) => (
                <li key={i}>{e.eventType.replace(/_/g, " ")} <span className="helper">({relTime(e.occurredAt)})</span></li>
              ))}
            </ul>
          )}
        </Card>
      </Section>
    </>
  );
}
