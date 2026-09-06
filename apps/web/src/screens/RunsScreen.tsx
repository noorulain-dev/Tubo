import { Card, EmptyState, Spinner, StatusPill } from "../components";
import { useRuns } from "../hooks";

export function RunsScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const { runs, loading, error } = useRuns();

  return (
    <>
      <div className="main-header">
        <div>
          <div className="page-title">Run history</div>
          <div className="page-subtitle">Every processed interaction, with its gap and review state.</div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <Card>
        {loading ? (
          <div className="loading-block"><Spinner /> Loading runs…</div>
        ) : runs.length === 0 ? (
          <EmptyState title="No runs yet" hint="Process an interaction to see it here." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Account</th>
                <th>Interaction</th>
                <th>Gaps</th>
                <th>Review</th>
                <th>Approved</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.createdAt.slice(0, 10)}</td>
                  <td>{r.accountId ?? "—"}</td>
                  <td className="row-link" onClick={() => onOpen(r.id)}>{r.id}</td>
                  <td>{r.gaps.length}</td>
                  <td>{r.proposals.filter((p) => p.status === "pending_approval").length}</td>
                  <td>{r.proposals.filter((p) => p.status === "approved" || p.status === "executed").length}</td>
                  <td><StatusPill value={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
