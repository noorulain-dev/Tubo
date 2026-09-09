import { useState } from "react";
import { AlertTriangle, CheckCircle2, Pencil, ShieldCheck, XCircle } from "lucide-react";
import { useRunMutations } from "../hooks";
import { EmptyState, ErrorNotice } from "../components/States";
import type { ProposalView, ReconciliationFinding, RunView, SemanticState } from "../types";

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
    out.push({ type: "Conditional commitment", description: c.action, owner: c.owner ?? undefined, deadline: c.deadline?.text, evidence: c.evidence[0]?.text });
  }
  for (const t of s.taskCandidates) {
    out.push({
      type: t.kind === "customer" ? "Customer commitment" : "Commitment",
      description: t.action,
      owner: t.owner ?? undefined,
      deadline: t.deadline?.text,
      evidence: t.evidence[0]?.text,
    });
  }
  for (const sig of s.commercialSignals) {
    out.push({ type: "Commercial signal", description: sig.text, evidence: sig.evidence[0]?.text });
  }
  for (const b of s.blockers) {
    out.push({ type: "Blocker", description: b });
  }
  return out;
}

function firstEvidence(f: ReconciliationFinding): string | undefined {
  return f.evidence?.[0]?.text;
}

function payloadStrings(payload: unknown): [string, string][] {
  if (!payload || typeof payload !== "object") return [];
  return Object.entries(payload as Record<string, unknown>).filter(([, v]) => typeof v === "string") as [string, string][];
}

function ProposalCard({
  proposal,
  pending,
  externalExecutionDisabled,
  onApprove,
  onReject,
  onExecute,
  onEdit,
}: {
  proposal: ProposalView;
  pending: boolean;
  externalExecutionDisabled?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onExecute: () => void;
  onEdit: (payload: Record<string, unknown>) => void;
}) {
  const p = proposal;
  const fields = payloadStrings(p.action.payload);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields));

  const awaitingApproval = p.status === "pending_approval";
  const approved = p.status === "approved";
  const blocked = p.action.blocked || p.policy.action === "blocked";
  const highRisk = p.policy.risk === "high" || p.policy.risk === "critical";

  return (
    <article className={`proposal ${approved ? "proposal-approved" : ""} ${blocked ? "proposal-blocked" : ""}`}>
      <div className="proposal-head">
        <div>
          <h3 className="proposal-title">{p.action.type.replace(/[._]/g, " ")}</h3>
          <p className="proposal-target">Target: {p.action.target}</p>
        </div>
        <div className="proposal-flags">
          <span className={`tag tag-risk-${p.policy.risk}`}>Risk {p.policy.risk}</span>
          <span className={`tag ${blocked ? "tag-danger" : p.policy.requiresApproval ? "tag-pending" : "tag-ok"}`}>
            {p.policy.action.replace(/_/g, " ")}
          </span>
          <span className="tag tag-muted">{p.status.replace(/_/g, " ")}</span>
        </div>
      </div>

      {fields.length > 0 && !editing && (
        <dl className="proposal-fields">
          {fields.map(([k, v]) => (
            <div key={k}>
              <dt>{k.replace(/_/g, " ")}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {editing && (
        <div className="proposal-edit">
          {fields.map(([k]) => (
            <div className="field" key={k}>
              <label htmlFor={`${p.id}-${k}`}>{k.replace(/_/g, " ")}</label>
              {(draft[k] ?? "").length > 80 ? (
                <textarea id={`${p.id}-${k}`} rows={5} value={draft[k] ?? ""} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              ) : (
                <input id={`${p.id}-${k}`} value={draft[k] ?? ""} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              )}
            </div>
          ))}
          <div className="proposal-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={pending}
              onClick={() => {
                onEdit({ ...(p.action.payload as Record<string, unknown>), ...draft });
                setEditing(false);
              }}
            >
              Save revision
            </button>
          </div>
        </div>
      )}

      <div className="proposal-why">
        <h4>Why this is proposed</h4>
        <ul>
          {p.policy.reasons.length > 0 ? p.policy.reasons.map((r, i) => <li key={i}>{r.replace(/_/g, " ")}</li>) : <li>{p.policy.reasonCode.replace(/_/g, " ")}</li>}
          {p.action.reviewReason && <li>{p.action.reviewReason}</li>}
        </ul>
      </div>

      {p.revisions.length > 0 && <p className="panel-hint">{p.revisions.length} revision(s) — the original proposal is preserved in the audit trail.</p>}

      {highRisk && awaitingApproval && (
        <p className="consequence">
          <AlertTriangle size={13} aria-hidden /> Approving authorises a change in a connected system. Nothing runs until you execute it.
        </p>
      )}

      {blocked && (
        <p className="blocked-note">
          <ShieldCheck size={13} aria-hidden /> This action was not executed. Additional approval or evidence is required.
        </p>
      )}

      {!editing && (
        <div className="proposal-actions">
          {awaitingApproval && (
            <>
              <button type="button" className="btn btn-ghost btn-sm btn-destructive" disabled={pending} onClick={onReject}>
                <XCircle size={14} aria-hidden /> Reject
              </button>
              {fields.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setEditing(true)}>
                  <Pencil size={14} aria-hidden /> Edit
                </button>
              )}
              <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={onApprove}>
                <CheckCircle2 size={14} aria-hidden /> Approve
              </button>
            </>
          )}
          {approved && !externalExecutionDisabled && (
            <div className="execute-bar">
              <span className="execute-note">Approved{p.approval ? ` by ${p.approval.reviewer}` : ""} — not yet executed.</span>
              <button type="button" className="btn btn-execute btn-sm" disabled={pending} onClick={onExecute}>
                Execute now
              </button>
            </div>
          )}
          {approved && externalExecutionDisabled && <span className="panel-hint">External execution is disabled in the evaluator workspace.</span>}
          {p.execution?.status && (
            <span className={`tag ${p.execution.status === "success" ? "tag-ok" : p.execution.status === "failed" ? "tag-danger" : "tag-pending"}`}>
              Execution {p.execution.status}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

export function ReviewScreen({
  run,
  onUpdated,
  onAudit,
  externalExecutionDisabled,
}: {
  run: RunView;
  onUpdated: (r: RunView) => void;
  onAudit: () => void;
  externalExecutionDisabled?: boolean;
}) {
  const { approve, reject, edit, execute, pending, error } = useRunMutations(run.id, onUpdated);
  const [technical, setTechnical] = useState(false);

  const semantic = semanticItems(run.semantic);
  const staleFindings = run.findings.filter((f) => f.classification === "stale" || f.classification === "contradictory");
  const reviewFindings = run.findings.filter((f) => f.classification === "ambiguous" || f.classification === "unsafe");
  const actionableGaps = run.gaps.filter((g) => g.type === "missing" || g.type === "duplicate");

  const stats = [
    { label: "What changed", value: semantic.length },
    { label: "Execution gaps", value: actionableGaps.length },
    { label: "CRM conflicts", value: staleFindings.length },
    { label: "Needs review", value: reviewFindings.length + run.proposals.filter((p) => p.status === "pending_approval").length },
  ];

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">{run.accountId ?? "Interaction analysis"}</h1>
          <p className="page-subtitle">
            <span className="tag tag-muted">{run.mode === "integration" ? "Fireflies" : "Manual"}</span>
            <span className={`tag ${run.status === "done" ? "tag-ok" : run.status === "failed" ? "tag-danger" : "tag-pending"}`}>{run.status.replace(/_/g, " ")}</span>
            <span className="mono-ref">{run.id}</span> · {new Date(run.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onAudit}>
            View audit trail
          </button>
        </div>
      </header>

      {error && <ErrorNotice error={error} />}
      {!run.semanticValid && run.semanticErrors.length > 0 && <ErrorNotice error={`Semantic extraction failed: ${run.semanticErrors.join("; ")}`} />}

      <div className="strip">
        {stats.map((s) => (
          <div className="strip-item" key={s.label}>
            <span className="strip-value">{s.value}</span>
            <span className="strip-label">{s.label}</span>
          </div>
        ))}
      </div>

      <section className="acct-section" aria-labelledby="rv-proposals">
        <div className="acct-section-head">
          <h2 id="rv-proposals">Proposed actions</h2>
          <span className="section-meta">Approval and execution are separate steps</span>
        </div>
        {run.proposals.length === 0 ? (
          <EmptyState title="No actions proposed." hint="Tubo found nothing that requires a change." tone="positive" />
        ) : (
          <div className="proposal-list">
            {run.proposals.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                pending={pending}
                externalExecutionDisabled={externalExecutionDisabled}
                onApprove={() => void approve(p.id)}
                onReject={() => void reject(p.id)}
                onExecute={() => void execute(p.id)}
                onEdit={(payload) => void edit(p.id, payload)}
              />
            ))}
          </div>
        )}
        <p className="panel-hint">Tubo never sends customer email automatically — drafts only.</p>
      </section>

      <section className="acct-section" aria-labelledby="rv-changed">
        <div className="acct-section-head">
          <h2 id="rv-changed">What changed</h2>
        </div>
        {semantic.length === 0 ? (
          <EmptyState title="Nothing was extracted from this interaction." />
        ) : (
          <ul className="semantic-list">
            {semantic.map((item, i) => (
              <li key={i}>
                <div className="semantic-head">
                  <span className="semantic-text">{item.description}</span>
                  <span className="tag tag-muted">{item.type}</span>
                </div>
                <div className="semantic-meta">
                  {item.owner && <span>Owner: {item.owner}</span>}
                  {item.deadline && <span>Deadline: {item.deadline}</span>}
                  <span>Source: conversation</span>
                </div>
                {item.evidence && <blockquote className="evidence-quote">{item.evidence}</blockquote>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="acct-section" aria-labelledby="rv-sources">
        <div className="acct-section-head">
          <h2 id="rv-sources">Sources checked</h2>
        </div>
        {run.activity.length === 0 ? (
          <EmptyState title="No context retrieval was needed." />
        ) : (
          <ul className="source-list">
            {run.activity.map((a, i) => (
              <li className={`source-item source-${a.status}`} key={i}>
                <span className="source-icon" aria-hidden>
                  {a.status === "retrieved" ? <CheckCircle2 size={14} /> : a.status === "skipped" ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}
                </span>
                <div>
                  <div className="source-name">{a.tool.replace(/_/g, " ")}</div>
                  <div className="source-result">{a.reason}</div>
                </div>
                <span className={`tag tag-${a.status === "retrieved" ? "ok" : a.status === "skipped" ? "muted" : "warn"}`}>{a.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {staleFindings.length > 0 && (
        <section className="acct-section" aria-labelledby="rv-state">
          <div className="acct-section-head">
            <h2 id="rv-state">Revenue state conflicts</h2>
          </div>
          <div className="gap-grid">
            {staleFindings.map((f, i) => (
              <article className="gap-card" key={i}>
                <div className="gap-card-head">
                  <span className={`tag tag-risk-${f.risk}`}>Risk {f.risk}</span>
                  <span className="finding-type">{f.classification}</span>
                </div>
                <h3 className="gap-title">{f.claimRef}</h3>
                <p className="gap-desc">{f.reason}</p>
                {f.proposedAction?.type === "update_stage" && (
                  <p className="gap-desc">
                    Recommended: update deal stage to <strong>{String((f.proposedAction.payload as { stage?: string })?.stage)}</strong>
                  </p>
                )}
                {firstEvidence(f) && <blockquote className="evidence-quote">{firstEvidence(f)}</blockquote>}
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="acct-section" aria-labelledby="rv-gaps">
        <div className="acct-section-head">
          <h2 id="rv-gaps">Execution gaps</h2>
        </div>
        {actionableGaps.length === 0 ? (
          <EmptyState title="No execution gaps." tone="positive" />
        ) : (
          <div className="gap-grid">
            {actionableGaps.map((g, i) => (
              <article className="gap-card" key={i}>
                <div className="gap-card-head">
                  <span className="finding-type">{g.type}</span>
                </div>
                <h3 className="gap-title">{g.title}</h3>
                <p className="gap-desc">{g.description}</p>
                {g.type === "duplicate" && <p className="resolved-note">Already handled — no new action required.</p>}
              </article>
            ))}
          </div>
        )}
      </section>

      {reviewFindings.length > 0 && (
        <section className="acct-section" aria-labelledby="rv-review">
          <div className="acct-section-head">
            <h2 id="rv-review">Needs human judgement</h2>
          </div>
          <ul className="commitment-list">
            {reviewFindings.map((f, i) => (
              <li className="commitment-row" key={i}>
                <div>
                  <div className="commitment-text">{f.claimRef}</div>
                  <div className="commitment-meta">{f.reason}</div>
                  {firstEvidence(f) && <blockquote className="evidence-quote">{firstEvidence(f)}</blockquote>}
                </div>
                <span className="tag tag-pending">{f.classification}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="technical" open={technical} onToggle={(e) => setTechnical((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Technical detail</summary>
        <pre className="tech-pre">{JSON.stringify({ id: run.id, mode: run.mode, status: run.status, semanticValid: run.semanticValid }, null, 2)}</pre>
      </details>
    </>
  );
}
