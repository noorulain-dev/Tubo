import {
  Button,
  Card,
  ClassificationBadge,
  EmptyState,
  ModePill,
  RiskBadge,
  Section,
  StatusPill,
  SummaryCard,
} from "../components";
import { useRunMutations } from "../hooks";
import type { ReconciliationFinding, RunView, SemanticState } from "../types";

interface SemanticItemView {
  type: string;
  description: string;
  owner?: string;
  deadline?: string;
  evidence?: string;
}

function semanticItems(s: SemanticState | null): SemanticItemView[] {
  if (!s) return [];
  const out: SemanticItemView[] = [];
  for (const d of s.decisions as { text?: string }[]) {
    out.push({ type: "Decision", description: d.text ?? "Decision" });
  }
  for (const c of s.confirmedCommitments) {
    out.push({ type: "Commitment", description: c.action, owner: c.owner ?? undefined, deadline: c.deadline?.text, evidence: c.evidence[0]?.text });
  }
  for (const c of s.conditionalCommitments) {
    out.push({ type: "Conditional Commitment", description: c.action, owner: c.owner ?? undefined, deadline: c.deadline?.text, evidence: c.evidence[0]?.text });
  }
  for (const t of s.taskCandidates) {
    out.push({ type: t.kind === "customer" ? "Customer Commitment" : "Commitment", description: t.action, owner: t.owner ?? undefined, deadline: t.deadline?.text, evidence: t.evidence[0]?.text });
  }
  for (const sig of s.commercialSignals) {
    out.push({ type: "Commercial Signal", description: sig.text, evidence: sig.evidence[0]?.text });
  }
  for (const b of s.blockers) {
    out.push({ type: "Blocker", description: b });
  }
  return out;
}

function firstEvidence(f: ReconciliationFinding): string | undefined {
  return f.evidence?.[0]?.text;
}

export function ReviewScreen({ run, onUpdated, onAudit }: { run: RunView; onUpdated: (r: RunView) => void; onAudit: () => void }) {
  const { approve, reject, edit, execute, pending, error } = useRunMutations(run.id, onUpdated);

  const semantic = semanticItems(run.semantic);
  const staleFindings = run.findings.filter((f) => f.classification === "stale" || f.classification === "contradictory");
  const reviewFindings = run.findings.filter((f) => f.classification === "ambiguous" || f.classification === "unsafe");
  const actionableGaps = run.gaps.filter((g) => g.type === "missing" || g.type === "duplicate");

  const summary = {
    whatChanged: semantic.length,
    executionGaps: actionableGaps.length,
    crmConflicts: staleFindings.length,
    needsReview: reviewFindings.length + run.proposals.filter((p) => p.status === "pending_approval").length,
  };

  const executed = run.proposals.filter((p) => p.execution);

  return (
    <>
      <div className="main-header">
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div className="page-title">{run.accountId ?? "Analysis"}</div>
            <ModePill value={run.mode} />
            <StatusPill value={run.status} />
          </div>
          <div className="page-subtitle">{run.id} · {run.createdAt.slice(0, 10)}</div>
        </div>
        <Button variant="ghost" onClick={onAudit}>View audit</Button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {!run.semanticValid && run.semanticErrors.length > 0 && (
        <div className="alert alert-error">Semantic extraction failed: {run.semanticErrors.join("; ")}</div>
      )}

      <div className="summary-grid">
        <SummaryCard label="What changed" value={summary.whatChanged} tone="accent" />
        <SummaryCard label="Execution gaps" value={summary.executionGaps} tone="warn" />
        <SummaryCard label="CRM conflicts" value={summary.crmConflicts} tone="danger" />
        <SummaryCard label="Needs review" value={summary.needsReview} tone="warn" />
      </div>

      <Section title="What changed">
        <Card>
          {semantic.length === 0 ? (
            <EmptyState title="No semantic items extracted" />
          ) : (
            <div className="item-list">
              {semantic.map((item, i) => (
                <div className="item" key={i}>
                  <div className="item-icon">•</div>
                  <div className="item-body">
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span className="item-title">{item.description}</span>
                      <span style={{ color: "var(--text-3)", fontSize: 12, whiteSpace: "nowrap" }}>{item.type}</span>
                    </div>
                    <div className="item-meta">
                      {item.owner && <>Owner: {item.owner} · </>}
                      {item.deadline && <>Deadline: {item.deadline} · </>}
                      Source: Conversation
                    </div>
                    {item.evidence && <div className="evidence">“{item.evidence}”</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Section>

      <Section title="Context gathered">
        <Card>
          {run.activity.length === 0 ? (
            <EmptyState title="No context retrieved" />
          ) : (
            <div className="item-list">
              {run.activity.map((a, i) => (
                <div className="item" key={i}>
                  <div className="item-icon" style={{ background: a.status === "skipped" ? "var(--surface-2)" : a.status === "retrieved" ? "var(--green-soft)" : "var(--red-soft)", color: a.status === "skipped" ? "var(--text-3)" : a.status === "retrieved" ? "var(--green)" : "var(--red)" }}>
                    {a.status === "skipped" ? "–" : a.status === "retrieved" ? "✓" : "!"}
                  </div>
                  <div className="item-body">
                    <div className="item-title">
                      {a.tool} <span style={{ fontWeight: 500, color: "var(--text-3)" }}>· {a.status === "retrieved" ? "Retrieved" : a.status === "skipped" ? "Skipped" : "Failed"}</span>
                    </div>
                    <div className="item-meta">Reason: {a.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Section>

      {staleFindings.length > 0 && (
        <Section title="Revenue state">
          <Card>
            {staleFindings.map((f, i) => (
              <div key={i} style={{ marginBottom: i < staleFindings.length - 1 ? 16 : 0 }}>
                <div className="finding-row">
                  <span className="finding-label">State finding</span>
                  <ClassificationBadge value={f.classification} />
                  <RiskBadge value={f.risk} />
                </div>
                <div style={{ fontSize: 13.5 }}>{f.reason}</div>
                {f.proposedAction?.type === "update_stage" && (
                  <div className="item-meta" style={{ marginTop: 6 }}>
                    Recommended: update deal stage to <strong>{String((f.proposedAction.payload as { stage?: string })?.stage)}</strong>
                  </div>
                )}
                <div className="item-meta" style={{ marginTop: 4 }}>Policy: approval required for consequential changes</div>
              </div>
            ))}
          </Card>
        </Section>
      )}

      <Section title="Execution gaps">
        <Card>
          {actionableGaps.length === 0 ? (
            <EmptyState title="No execution gaps" />
          ) : (
            <div className="item-list">
              {actionableGaps.map((g, i) => (
                <div className="item" key={i}>
                  <div className="item-icon"><ClassificationBadge value={g.type} /></div>
                  <div className="item-body">
                    <div className="item-title">{g.title}</div>
                    <div className="item-meta">{g.description}</div>
                    {g.type === "duplicate" && (
                      <div className="item-meta" style={{ marginTop: 6, fontWeight: 600, color: "var(--green)" }}>No new action required.</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Section>

      <Section title="Needs review">
        <Card>
          {reviewFindings.length === 0 ? (
            <EmptyState title="Nothing to review" />
          ) : (
            <div className="item-list">
              {reviewFindings.map((f, i) => (
                <div className="item" key={i}>
                  <div className="item-icon"><ClassificationBadge value={f.classification} /></div>
                  <div className="item-body">
                    <div className="item-title">{f.claimRef}</div>
                    <div className="item-meta">{f.reason}</div>
                    {firstEvidence(f) && <div className="evidence">“{firstEvidence(f)}”</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Section>

      <Section title="Proposed actions">
        <Card>
          {run.proposals.length === 0 ? (
            <EmptyState title="No proposed actions" />
          ) : (
            <div className="item-list">
              {run.proposals.map((p) => (
                <div className="item" key={p.id}>
                  <div className="item-icon">{p.action.type.startsWith("create_draft") ? "✉" : "✓"}</div>
                  <div className="item-body">
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span className="item-title">{p.action.type.replace(/_/g, " ")}</span>
                      <span className="pill">{p.status}</span>
                    </div>
                    <div className="item-meta">Policy: {p.policy.action} {p.policy.requiresApproval ? "(approval required)" : ""}</div>
                    {p.revisions.length > 0 && <div className="item-meta">Revisions: {p.revisions.length} (original AI proposal preserved)</div>}
                    <div className="review-controls">
                      {p.status === "pending_approval" && (
                        <>
                          <Button variant="primary" disabled={pending} onClick={() => void approve(p.id)}>Approve</Button>
                          <Button variant="danger" disabled={pending} onClick={() => void reject(p.id)}>Reject</Button>
                        </>
                      )}
                      {p.status === "approved" && (
                        <Button variant="primary" disabled={pending} onClick={() => void execute(p.id)}>Execute</Button>
                      )}
                      {p.execution?.status && <span className="item-meta">Result: {p.execution.status}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Section>

      {executed.length > 0 && (
        <Section title="Execution result">
          <Card>
            <div className="item-list">
              {executed.map((p) => (
                <div className="exec-item" key={p.id}>
                  <span className={`exec-mark exec-${p.execution!.status === "success" ? "success" : p.execution!.status === "skipped" ? "skipped" : "failed"}`}>
                    {p.execution!.status === "success" ? "✓" : p.execution!.status === "skipped" ? "!" : "✕"}
                  </span>
                  {p.action.type.replace(/_/g, " ")} — {p.execution!.status}
                  {p.execution!.error && <span style={{ color: "var(--red)" }}> ({p.execution!.error})</span>}
                </div>
              ))}
            </div>
          </Card>
        </Section>
      )}

      <p className="helper">Revenue Execution OS never sends customer email automatically — drafts only.</p>
    </>
  );
}
