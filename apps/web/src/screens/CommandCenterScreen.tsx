import { Button, Card, EmptyState, Section, SeverityBadge, Spinner, SummaryCard, TestDataBadge } from "../components";
import { useCommandCenter } from "../hooks";
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

export function CommandCenterScreen({ onOpenAccount }: { onOpenAccount: (accountId: string) => void }) {
  const { rows, total, loading, error, refresh } = useCommandCenter();

  const criticalHigh = rows.filter((r) => r.highestSeverity === "critical" || r.highestSeverity === "high").length;
  const openCommitments = rows.reduce((n, r) => n + r.openCommitments, 0);
  const openQuestions = rows.reduce((n, r) => n + r.openQuestions, 0);
  const mismatches = rows.filter((r) => r.topFinding?.type === "commercial_crm_mismatch").length;
  const blocked = rows.filter((r) => r.blocked).length;

  return (
    <>
      <div className="main-header">
        <div>
          <div className="page-title">Command Center</div>
          <div className="page-subtitle">What needs your attention right now.</div>
        </div>
        <Button variant="secondary" onClick={() => void refresh()}>Refresh</Button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="summary-grid">
        <SummaryCard label="Accounts requiring attention" value={total} tone="accent" />
        <SummaryCard label="Critical / high findings" value={criticalHigh} tone="danger" />
        <SummaryCard label="Open commitments" value={openCommitments} tone="warn" />
        <SummaryCard label="Unanswered questions" value={openQuestions} tone="neutral" />
        <SummaryCard label="CRM / commercial mismatches" value={mismatches} tone="warn" />
        <SummaryCard label="Blocked" value={blocked} tone="danger" />
      </div>

      <Section title="Priority queue" subtitle="Ordered by severity, then recency.">
        <Card>
          {loading ? (
            <div className="loading-block"><Spinner /> Loading accounts…</div>
          ) : rows.length === 0 ? (
            <EmptyState title="No accounts needing attention" hint="Process an interaction or connect an integration to populate state." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>CRM stage</th>
                  <th>Commercial</th>
                  <th>Priority</th>
                  <th>Top issue</th>
                  <th>Commitments / questions</th>
                  <th>Last event</th>
                  <th>Pending</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.accountId}>
                    <td className="row-link" onClick={() => onOpenAccount(r.accountId)}>
                      {r.identity?.name ?? r.accountId}
                      {r.isAssessment && <> <TestDataBadge /></>}
                    </td>
                    <td>{r.stage ?? "—"}</td>
                    <td>{r.commercial ?? "—"}</td>
                    <td><SeverityBadge value={r.highestSeverity} /></td>
                    <td>{r.topFinding?.title ?? "—"}</td>
                    <td>{r.openCommitments} / {r.openQuestions}</td>
                    <td>{relTime(r.lastMeaningfulEventAt)}</td>
                    <td>{r.pendingCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </Section>
    </>
  );
}
