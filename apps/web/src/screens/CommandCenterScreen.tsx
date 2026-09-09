import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, HelpCircle, RefreshCw } from "lucide-react";
import { useCommandCenter } from "../hooks";
import { EmptyState, ErrorNotice, Skeleton } from "../components/States";
import type { AccountRow } from "../types";

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

/** Plain-English "why it matters" derived from the finding type the backend produced. */
const WHY: Record<string, string> = {
  commercial_crm_mismatch: "CRM and commercial state disagree, so any change made from CRM alone would be wrong.",
  missing_commercial_context: "Commercial state could not be verified, so consequential changes are unsafe.",
  stale_crm: "CRM has not caught up with what the customer actually said.",
  unanswered_question: "A customer question is still open and the account is waiting on you.",
  overdue_commitment: "Something was promised to the customer and the due date has passed.",
  contradictory_state: "Two sources contradict each other about this account.",
  blocked_execution: "An action was stopped because policy required more evidence or approval.",
};

const NEXT_STEP: Record<string, string> = {
  commercial_crm_mismatch: "Review the evidence and confirm which source is authoritative.",
  missing_commercial_context: "Supply or refresh the commercial source, then re-run reconciliation.",
  stale_crm: "Approve the CRM update Tubo prepared.",
  unanswered_question: "Answer the open question or assign it.",
  overdue_commitment: "Close out or reschedule the commitment.",
  contradictory_state: "Investigate the contradiction before any CRM change.",
  blocked_execution: "Review the blocked action and decide.",
};

function why(row: AccountRow): string {
  const t = row.topFinding?.type ?? "";
  return WHY[t] ?? "Tubo found operational state that no longer matches the conversation.";
}

function nextStep(row: AccountRow): string {
  if ((row.needsContextCount ?? 0) > 0) return "Answer the open context question, then Tubo re-reconciles.";
  const t = row.topFinding?.type ?? "";
  return NEXT_STEP[t] ?? "Open the account and review the evidence.";
}

type QueueFilter = "all" | "needs_review" | "needs_context" | "ready_for_approval" | "blocked";

const FILTERS: { id: QueueFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_review", label: "Needs review" },
  { id: "needs_context", label: "Needs context" },
  { id: "ready_for_approval", label: "Ready for approval" },
  { id: "blocked", label: "Blocked" },
];

/** Deterministic bucketing from the row the backend already computed. */
function matchesFilter(row: AccountRow, filter: QueueFilter): boolean {
  switch (filter) {
    case "needs_context":
      return (row.needsContextCount ?? 0) > 0;
    case "ready_for_approval":
      return row.pendingCount > 0;
    case "blocked":
      return row.blocked || row.blockerCount > 0;
    case "needs_review":
      return (row.needsContextCount ?? 0) === 0 && row.pendingCount === 0 && !row.blocked;
    default:
      return true;
  }
}

export function CommandCenterScreen({ onOpenAccount }: { onOpenAccount: (accountId: string) => void }) {
  const { rows, total, loading, error, refresh } = useCommandCenter();
  const [refreshedAt, setRefreshedAt] = useState<Date>(() => new Date());
  const [filter, setFilter] = useState<QueueFilter>("all");

  const stats = useMemo(() => {
    const severityRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    const sorted = [...rows].sort((a, b) => {
      const s = (severityRank[b.highestSeverity ?? ""] ?? 0) - (severityRank[a.highestSeverity ?? ""] ?? 0);
      if (s !== 0) return s;
      return Date.parse(b.lastMeaningfulEventAt ?? "0") - Date.parse(a.lastMeaningfulEventAt ?? "0");
    });
    return {
      sorted,
      criticalHigh: rows.filter((r) => r.highestSeverity === "critical" || r.highestSeverity === "high").length,
      openCommitments: rows.reduce((n, r) => n + r.openCommitments, 0),
      openQuestions: rows.reduce((n, r) => n + r.openQuestions, 0),
      mismatches: rows.filter((r) => (r.topFinding?.type ?? "").includes("mismatch")).length,
      needsContext: rows.filter((r) => (r.needsContextCount ?? 0) > 0).length,
    };
  }, [rows]);

  // "Needs context" is surfaced first: it is the cheapest unblock available.
  const visible = useMemo(
    () =>
      stats.sorted
        .filter((r) => matchesFilter(r, filter))
        .sort((a, b) => (b.needsContextCount ?? 0 ? 1 : 0) - (a.needsContextCount ?? 0 ? 1 : 0)),
    [stats.sorted, filter],
  );

  async function handleRefresh() {
    await refresh();
    setRefreshedAt(new Date());
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Command Center</h1>
          <p className="page-subtitle">Revenue work that needs attention.</p>
        </div>
        <div className="page-head-actions">
          <span className="page-head-meta">
            Last refreshed {refreshedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleRefresh()} disabled={loading}>
            <RefreshCw size={14} aria-hidden /> Refresh
          </button>
        </div>
      </header>

      {error != null && <ErrorNotice error={error} onRetry={() => void handleRefresh()} />}

      <div className="stat-strip" role="list">
        <div className="stat" role="listitem">
          <span className="stat-value">{total}</span>
          <span className="stat-label">Needs attention</span>
        </div>
        <div className="stat" role="listitem">
          <span className="stat-value danger">{stats.criticalHigh}</span>
          <span className="stat-label">Critical / high</span>
        </div>
        <div className="stat" role="listitem">
          <span className="stat-value">{stats.openCommitments}</span>
          <span className="stat-label">Open commitments</span>
        </div>
        <div className="stat" role="listitem">
          <span className="stat-value">{stats.openQuestions}</span>
          <span className="stat-label">Unanswered questions</span>
        </div>
        <div className="stat" role="listitem">
          <span className="stat-value warn">{stats.mismatches}</span>
          <span className="stat-label">CRM mismatches</span>
        </div>
        <div className="stat" role="listitem">
          <span className="stat-value warn">{stats.needsContext}</span>
          <span className="stat-label">Needs context</span>
        </div>
      </div>

      <section className="queue" aria-label="Attention queue">
        <div className="queue-head">
          <h2 className="section-title">Attention queue</h2>
          <span className="section-meta">Ordered by severity, then recency</span>
        </div>

        <div className="queue-filters" role="tablist" aria-label="Filter attention queue">
          {FILTERS.map((f) => {
            const count = f.id === "all" ? rows.length : rows.filter((r) => matchesFilter(r, f.id)).length;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={`filter-chip${filter === f.id ? " is-active" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label} <span className="filter-count">{count}</span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <Skeleton rows={4} height={104} />
        ) : visible.length === 0 ? (
          <div className="reconciled">
            <CheckCircle2 size={26} aria-hidden />
            <h3>Everything is reconciled.</h3>
            <p>No unresolved execution gaps right now.</p>
            <a className="btn btn-primary btn-sm" href="/app/process">
              Process an interaction
            </a>
          </div>
        ) : (
          <ul className="queue-list">
            {visible.map((r) => (
              <li key={r.accountId}>
                <article className={`queue-card sev-${r.highestSeverity ?? "low"}`}>
                  <div className="queue-card-main">
                    <div className="queue-card-top">
                      <span className={`sev-pill sev-${r.highestSeverity ?? "low"}`}>{r.highestSeverity ?? "low"}</span>
                      <button type="button" className="queue-account" onClick={() => onOpenAccount(r.accountId)}>
                        {r.identity?.name ?? r.accountId}
                      </button>
                      {r.topFinding && <span className="finding-type">{r.topFinding.type.replace(/_/g, " ")}</span>}
                      {(r.needsContextCount ?? 0) > 0 && (
                        <span className="tag tag-context">
                          <HelpCircle size={12} aria-hidden /> Needs context
                          {r.needsContextCount > 1 ? ` · ${r.needsContextCount}` : ""}
                        </span>
                      )}
                      {r.isAssessment && <span className="tag tag-muted">Test data</span>}
                    </div>
                    <p className="queue-issue">{r.topFinding?.title ?? "Operational state needs review."}</p>
                    <p className="queue-why">{why(r)}</p>
                    <div className="queue-evidence">
                      <span className="tag tag-evidence">{r.openCommitments} commitments</span>
                      <span className="tag tag-evidence">{r.openQuestions} questions</span>
                      {r.blockerCount > 0 && <span className="tag tag-warn">{r.blockerCount} blockers</span>}
                      {r.pendingCount > 0 && <span className="tag tag-pending">{r.pendingCount} awaiting approval</span>}
                      <span className="tag tag-muted">{r.stage ?? "no stage"}</span>
                      <span className="queue-time">Changed {relTime(r.lastMeaningfulEventAt)}</span>
                    </div>
                  </div>
                  <div className="queue-card-side">
                    <div className="queue-next">
                      <span className="queue-next-label">Recommended next step</span>
                      <span className="queue-next-text">{nextStep(r)}</span>
                    </div>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpenAccount(r.accountId)}>
                      Review <ArrowRight size={14} aria-hidden />
                    </button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!loading && rows.length === 0 && error == null && (
        <EmptyState title="Nothing is waiting on you." hint="New interactions will show up here as soon as they are processed." tone="positive" />
      )}
    </>
  );
}
