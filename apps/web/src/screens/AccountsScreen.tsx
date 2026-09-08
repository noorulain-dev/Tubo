import { Card, EmptyState, SeverityBadge, Spinner, TestDataBadge } from "../components";
import { useCommandCenter } from "../hooks";

export function AccountsScreen({ onOpenAccount }: { onOpenAccount: (accountId: string) => void }) {
  const { rows, loading, error } = useCommandCenter();

  return (
    <>
      <div className="main-header">
        <div>
          <div className="page-title">Accounts</div>
          <div className="page-subtitle">Every account with persisted operational intelligence.</div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <Card>
        {loading ? (
          <div className="loading-block"><Spinner /> Loading accounts…</div>
        ) : rows.length === 0 ? (
          <EmptyState title="No accounts yet" hint="Process an interaction to create account intelligence." />
        ) : (
          <table className="table">
            <thead>
              <tr><th>Account</th><th>Stage</th><th>Commercial</th><th>Severity</th><th>Open</th></tr>
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
                  <td>{r.openCommitments + r.openQuestions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
