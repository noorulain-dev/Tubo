import { useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, RefreshCw, Search } from "lucide-react";
import { api } from "../api";
import { useAccountDetail, useContextGaps } from "../hooks";
import { EmptyState, ErrorNotice, LoadingBlock, Skeleton } from "../components/States";
import { ContextResolutionSheet, GAP_LABEL, NeedsContextCard } from "../components/ContextResolution";
import type { ContextGap, Finding, InvestigationOutcome, InvestigationResult } from "../types";


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

const OUTCOME_LABEL: Record<InvestigationOutcome, string> = {
  confirmed: "Confirmed",
  rejected: "Rejected",
  ambiguous: "Ambiguous",
  missing_context: "Missing context",
};

const OUTCOME_TONE: Record<InvestigationOutcome, string> = {
  confirmed: "danger",
  rejected: "ok",
  ambiguous: "warn",
  missing_context: "warn",
};

/** Deterministic guidance per outcome — no model reasoning text is exposed. */
const OUTCOME_RECOMMENDATION: Record<InvestigationOutcome, string> = {
  confirmed: "The gap is real. Review the prepared action and approve it if the evidence matches your judgement.",
  rejected: "Sources do not support this gap. No change is recommended; the finding can be closed.",
  ambiguous: "Sources disagree. Confirm with the customer or an owner before any consequential change.",
  missing_context: "Tubo cannot safely recommend this change yet because the required state could not be verified.",
};

function Section({ id, title, meta, children }: { id: string; title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="acct-section" aria-labelledby={id}>
      <div className="acct-section-head">
        <h2 id={id}>{title}</h2>
        {meta && <span className="section-meta">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function GapCard({ finding, onInvestigate, busy }: { finding: Finding; onInvestigate: () => void; busy: boolean }) {
  return (
    <article className={`gap-card sev-${finding.severity}`}>
      <div className="gap-card-head">
        <span className={`sev-pill sev-${finding.severity}`}>{finding.severity}</span>
        <span className="finding-type">{finding.type.replace(/_/g, " ")}</span>
        <span className={`tag ${finding.status === "open" ? "tag-pending" : "tag-ok"}`}>{finding.status}</span>
      </div>
      <h3 className="gap-title">{finding.title}</h3>
      {finding.description && <p className="gap-desc">{finding.description}</p>}
      {finding.evidence.length > 0 && (
        <ul className="evidence-list">
          {finding.evidence.slice(0, 4).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <div className="gap-meta">
        {finding.sourceReferences.map((s) => (
          <span className="tag tag-evidence" key={s}>
            {s}
          </span>
        ))}
        {finding.signals.slice(0, 3).map((s) => (
          <span className="tag tag-muted" key={s.signal}>
            {s.signal}: {String(s.value)}
          </span>
        ))}
        <span className="queue-time">Updated {relTime(finding.updatedAt)}</span>
      </div>
      {finding.needsInvestigation && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onInvestigate} disabled={busy}>
          <Search size={14} aria-hidden /> Investigate
        </button>
      )}
    </article>
  );
}

function InvestigationPanel({ result }: { result: InvestigationResult }) {
  const tone = OUTCOME_TONE[result.outcome];
  return (
    <div className="investigation">
      <div className="investigation-head">
        <span className={`alignment alignment-${tone}`}>
          <span className="alignment-label">{OUTCOME_LABEL[result.outcome]}</span>
        </span>
        <span className="section-meta">
          {result.budget.used}/{result.budget.max} checks used
        </span>
      </div>

      <h4 className="investigation-sub">Sources checked</h4>
      <ul className="source-list">
        {result.trace.map((s, i) => (
          <li key={i} className={`source-item source-${s.status}`}>
            <span className="source-icon" aria-hidden>
              {s.status === "success" ? <CheckCircle2 size={14} /> : s.status === "cache" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            </span>
            <div>
              <div className="source-name">{(s.source ?? s.tool).replace(/_/g, " ")}</div>
              <div className="source-result">{s.factualResult}</div>
            </div>
            <span className={`tag tag-${s.status === "success" || s.status === "cache" ? "ok" : "warn"}`}>
              {s.status === "success" || s.status === "cache" ? "available" : "unavailable"}
            </span>
          </li>
        ))}
      </ul>

      <div className="recommendation">
        <h4>What Tubo recommends</h4>
        <p>{OUTCOME_RECOMMENDATION[result.outcome]}</p>
      </div>
    </div>
  );
}

export function AccountScreen({ accountId }: { accountId: string }) {
  const { detail, loading, error, refresh } = useAccountDetail(accountId);
  const [investigating, setInvestigating] = useState(false);
  const [investigation, setInvestigation] = useState<InvestigationResult | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const context = useContextGaps(accountId);
  const [openGap, setOpenGap] = useState<ContextGap | null>(null);

  /** Latest human answer per gap, for the "Resolved by …" line. */
  const resolutionByGap = new Map(context.resolutions.map((r) => [r.gapId, r]));
  const gapsFor = (subjectId: string) => context.gaps.filter((g) => g.subject.id === subjectId);

  async function saveResolution(gapId: string, choice: Parameters<typeof context.resolve>[1]) {
    const result = await context.resolve(gapId, choice);
    // Reconciliation already re-ran on the backend; pull the recomputed account.
    await refresh();
    return result;
  }


  async function markReviewed() {
    setActionError(null);
    try {
      await api.markReviewed(accountId);
      await refresh();
    } catch (e) {
      setActionError(e);
    }
  }

  async function sourceRefresh() {
    setActionError(null);
    setRefreshing(true);
    try {
      await api.refreshAccount(accountId);
      setTimeout(() => {
        void refresh();
        setRefreshing(false);
      }, 1500);
    } catch (e) {
      setActionError(e);
      setRefreshing(false);
    }
  }

  async function investigate(findingId: string) {
    setInvestigating(true);
    setActionError(null);
    try {
      setInvestigation(await api.investigateFinding(findingId));
      await refresh();
    } catch (e) {
      setActionError(e);
    } finally {
      setInvestigating(false);
    }
  }

  async function planDecision(planId: string, actionId: string, decision: "approve" | "reject") {
    setActing(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await api.applyPlanDecision(planId, actionId, decision);
      setActionMessage(decision === "approve" ? "Action approved." : "Action rejected.");
      await refresh();
    } catch (e) {
      setActionError(e);
    } finally {
      setActing(false);
    }
  }

  if (loading) return <Skeleton rows={5} height={92} />;
  if (error) return <ErrorNotice error={error} onRetry={() => void refresh()} />;
  if (!detail) return <EmptyState title="Account not found." hint="It may have been removed from this workspace." />;

  const s = detail.snapshot;
  const name = s.identity?.name ?? accountId;
  const isAssessment = accountId.startsWith("[ASSESSMENT]") || name.includes("[ASSESSMENT]");
  const openFindings = detail.findings.filter((f) => f.status === "open");
  const shownInvestigation = investigation ?? detail.latestInvestigation;

  return (
    <>
      <header className="page-head account-head">
        <div>
          <h1 className="page-title">
            {name} {isAssessment && <span className="tag tag-muted">Test data</span>}
          </h1>
          <p className="page-subtitle">
            CRM stage <strong>{s.stage ?? "not set"}</strong> · Commercial <strong>{s.commercial?.status ?? "unverified"}</strong> · Updated{" "}
            {relTime(s.recentEvents?.[0]?.occurredAt ?? null)}
          </p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void sourceRefresh()} disabled={refreshing}>
            <RefreshCw size={14} aria-hidden /> {refreshing ? "Refreshing…" : "Refresh account"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void markReviewed()}>
            Mark reviewed
          </button>
        </div>
      </header>

      {actionError != null && <ErrorNotice error={actionError} />}
      {actionMessage != null && (
        <div className="notice notice-success" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          <div className="notice-body">
            <div className="notice-title">{actionMessage}</div>
          </div>
        </div>
      )}

      <Section id="changed" title="What changed" meta={detail.lastReviewedAt ? `Last reviewed ${relTime(detail.lastReviewedAt)}` : "Not reviewed yet"}>
        <div className="panel">
          {detail.lastReviewedAt ? (
            <ul className="change-list">
              {detail.changes.stage && (
                <li>
                  Stage <b>{detail.changes.stage.before ?? "—"}</b> → <b>{detail.changes.stage.after}</b>
                </li>
              )}
              {detail.changes.commercial && (
                <li>
                  Commercial <b>{detail.changes.commercial.before ?? "—"}</b> → <b>{detail.changes.commercial.after}</b>
                </li>
              )}
              {detail.changes.newCommitments.map((c) => (
                <li key={`nc-${c}`}>New commitment: {c}</li>
              ))}
              {detail.changes.resolvedCommitments.map((c) => (
                <li key={`rc-${c}`}>Resolved commitment: {c}</li>
              ))}
              {detail.changes.newQuestions.map((q) => (
                <li key={`nq-${q}`}>New question: {q}</li>
              ))}
              {detail.changes.answeredQuestions.map((q) => (
                <li key={`aq-${q}`}>Answered question: {q}</li>
              ))}
              {detail.changes.newBlockers.map((b) => (
                <li key={`nb-${b}`}>New blocker: {b}</li>
              ))}
              {detail.changes.eventsSince === 0 && !detail.changes.stage && !detail.changes.commercial && <li>No changes since last review.</li>}
            </ul>
          ) : (
            <p className="panel-hint">Everything here is new since your first view of this account.</p>
          )}
        </div>
      </Section>

      <Section id="state" title="Current state">
        <div className="state-grid">
          <div className="panel">
            <h3 className="panel-title">CRM</h3>
            <dl className="panel-kv">
              <div>
                <dt>Stage</dt>
                <dd>{s.stage ?? "Not set"}</dd>
              </div>
              <div>
                <dt>Company</dt>
                <dd>{s.identity?.companyId ?? "—"}</dd>
              </div>
              <div>
                <dt>Deal</dt>
                <dd>{s.identity?.dealId ?? "—"}</dd>
              </div>
            </dl>
          </div>
          <div className="panel">
            <h3 className="panel-title">Commercial</h3>
            <dl className="panel-kv">
              <div>
                <dt>State</dt>
                <dd>{s.commercial?.status ?? "Unverified"}</dd>
              </div>
              <div>
                <dt>Provenance</dt>
                <dd>{s.commercial?.provenance ?? "—"}</dd>
              </div>
              <div>
                <dt>Last source refresh</dt>
                <dd>{relTime(s.lastSourceRefresh)}</dd>
              </div>
            </dl>
          </div>
          <div className="panel">
            <h3 className="panel-title">Communication</h3>
            <dl className="panel-kv">
              <div>
                <dt>Recent events</dt>
                <dd>{s.recentEvents.length}</dd>
              </div>
              <div>
                <dt>Last event</dt>
                <dd>{relTime(s.recentEvents?.[0]?.occurredAt ?? null)}</dd>
              </div>
              <div>
                <dt>Unavailable sources</dt>
                <dd>{s.unavailableSources.length ? s.unavailableSources.join(", ") : "None"}</dd>
              </div>
            </dl>
          </div>
        </div>
      </Section>

      {/* Account- and source-level context questions. Commitment-level ones are
          rendered inline under the commitment they block. */}
      {(() => {
        const accountGaps = context.gaps.filter((g) => g.subject.kind !== "commitment");
        if (accountGaps.length === 0) return null;
        return (
          <Section id="needs-context" title="Needs context" meta={`${accountGaps.length} unanswered`}>
            <div className="context-grid">
              {accountGaps.map((g) => (
                <NeedsContextCard key={g.gapId} gap={g} resolution={resolutionByGap.get(g.gapId)} onOpen={setOpenGap} />
              ))}
            </div>
          </Section>
        );
      })()}


      <Section id="gaps" title="Execution gaps" meta={`${openFindings.length} open`}>
        {openFindings.length === 0 ? (
          <EmptyState title="No open execution gaps." hint="This account is reconciled." tone="positive" />
        ) : (
          <div className="gap-grid">
            {openFindings.map((f) => (
              <GapCard key={f.findingId} finding={f} busy={investigating} onInvestigate={() => void investigate(f.findingId)} />
            ))}
          </div>
        )}
      </Section>

      <Section id="investigation" title="Investigation">
        {investigating ? (
          <LoadingBlock label="Checking sources" />
        ) : shownInvestigation ? (
          <InvestigationPanel result={shownInvestigation} />
        ) : (
          <EmptyState title="No investigation yet." hint="Investigate a gap to confirm or reject it against its sources." />
        )}
      </Section>

      {detail.plans.length > 0 && (
        <Section id="plans" title="Prepared actions">
          {detail.plans.map((p) => (
            <div className="panel plan" key={p.planId}>
              <h3 className="panel-title">{p.objective}</h3>
              {p.summary && <p className="panel-hint">{p.summary}</p>}
              {p.evidence.length > 0 && (
                <div className="gap-meta">
                  {p.evidence.map((e, i) => (
                    <span className="tag tag-evidence" key={i}>
                      {e}
                    </span>
                  ))}
                </div>
              )}
              <ul className="action-list">
                {p.actions.map((a) => {
                  const decidable = a.status === "pending_approval" || a.status === "ready";
                  const highRisk = a.policy.risk === "high" || a.policy.risk === "critical";
                  return (
                    <li className="action-row" key={a.actionId}>
                      <div className="action-main">
                        <div className="action-title">{a.action.type.replace(/[._]/g, " ")}</div>
                        <div className="action-meta">
                          <span>Target: {a.action.target}</span>
                          <span className={`tag tag-risk-${a.policy.risk}`}>Risk {a.policy.risk}</span>
                          <span className="tag tag-muted">{a.policy.action.replace(/_/g, " ")}</span>
                          <span className={`tag ${a.status === "executed" ? "tag-ok" : "tag-pending"}`}>{a.status.replace(/_/g, " ")}</span>
                        </div>
                        {highRisk && decidable && (
                          <p className="consequence">
                            <AlertTriangle size={13} aria-hidden /> Approving this writes to a connected system.
                          </p>
                        )}
                        {a.dependencyBlocked && (
                          <p className="consequence">
                            <HelpCircle size={13} aria-hidden /> Waiting on another action in this plan.
                          </p>
                        )}
                      </div>
                      {decidable && (
                        <div className="action-actions">
                          <button type="button" className="btn btn-ghost btn-sm" disabled={acting} onClick={() => void planDecision(p.planId, a.actionId, "reject")}>
                            Reject
                          </button>
                          <button type="button" className="btn btn-primary btn-sm" disabled={acting} onClick={() => void planDecision(p.planId, a.actionId, "approve")}>
                            Approve
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </Section>
      )}

      <Section id="commitments" title="Commitments" meta={`${s.commitments.length} tracked`}>
        {s.commitments.length === 0 ? (
          <EmptyState title="No commitments on this account." />
        ) : (
          <ul className="commitment-list">
            {s.commitments.map((c) => (
              <li className="commitment-row commitment-row-block" key={c.id}>
                <div className="commitment-row-main">
                  <div>
                    <div className="commitment-text">{c.description}</div>
                    <div className="commitment-meta">
                      <span>
                        Owner: {c.owner ?? (c.ownerResolution === "ambiguous" ? "ambiguous" : "unassigned")}
                        {c.ownerProvenance === "human_supplied" && <span className="tag tag-human">human supplied</span>}
                      </span>
                      <span>
                        Due:{" "}
                        {c.dueDate
                          ? new Date(c.dueDate).toLocaleDateString()
                          : c.dueDateWaived
                            ? "no deadline (confirmed)"
                            : c.dueDateText ?? "not set"}
                        {c.dueDateProvenance === "human_supplied" && <span className="tag tag-human">human supplied</span>}
                      </span>
                    </div>
                  </div>
                  <span className={`tag ${c.status === "open" ? "tag-pending" : "tag-ok"}`}>{c.status}</span>
                </div>
                {/* Unresolved context sits directly under the commitment it blocks. */}
                {gapsFor(c.id).map((g) => (
                  <NeedsContextCard key={g.gapId} gap={g} resolution={resolutionByGap.get(g.gapId)} onOpen={setOpenGap} />
                ))}
              </li>
            ))}
          </ul>

        )}
      </Section>

      <Section id="questions" title="Customer questions" meta={`${s.questions.filter((q) => q.status === "open").length} open`}>
        {s.questions.length === 0 ? (
          <EmptyState title="No open customer questions." />
        ) : (
          <ul className="commitment-list">
            {s.questions.map((q) => (
              <li className="commitment-row" key={q.id}>
                <div>
                  <div className="commitment-text">{q.question}</div>
                  {q.answer && <div className="commitment-meta">Answer: {q.answer.text}</div>}
                </div>
                <span className={`tag ${q.status === "open" ? "tag-pending" : "tag-ok"}`}>{q.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="blockers" title="Blockers">
        {s.blockers.length === 0 ? (
          <EmptyState title="No blockers." tone="positive" />
        ) : (
          <ul className="blocker-list">
            {s.blockers.map((b, i) => (
              <li key={i}>
                <AlertTriangle size={14} aria-hidden /> {b}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="activity" title="Activity">
        {detail.recentEvents.length === 0 ? (
          <EmptyState title="No recorded activity yet." />
        ) : (
          <ol className="activity-list">
            {detail.recentEvents.slice(0, 20).map((e) => (
              <li key={e.eventId}>
                <span className="activity-dot" aria-hidden />
                <span className="activity-type">{e.eventType.replace(/_/g, " ")}</span>
                {e.source && <span className="tag tag-muted">{e.source}</span>}
                <span className="activity-time">{relTime(e.occurredAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {context.resolutions.length > 0 && (
        <Section id="context-audit" title="Context supplied by people" meta={`${context.resolutions.length} recorded`}>
          <ul className="context-audit">
            {context.resolutions.map((r) => (
              <li key={r.resolutionId}>
                <div>
                  <div className="context-audit-q">
                    <span className="context-kind">{GAP_LABEL[r.gapType]}</span> {r.question}
                  </div>
                  <div className="context-audit-meta">
                    {r.subjectLabel} · originally: {r.originalAmbiguity[0] ?? "unverified"}
                  </div>
                </div>
                <div className="context-audit-value">
                  <strong>{r.selectedLabel}</strong>
                  <span>
                    Resolved by {r.resolvedByName ?? r.resolvedBy} · {new Date(r.resolvedAt).toLocaleString()}
                  </span>
                  <span className="tag tag-human">human supplied</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <ContextResolutionSheet
        gap={openGap}
        saving={context.saving}
        error={context.error}
        onClose={() => setOpenGap(null)}
        onSave={saveResolution}
      />
    </>

  );
}
