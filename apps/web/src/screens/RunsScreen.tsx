import { Link } from "react-router-dom";
import { useRuns } from "../hooks";
import { StatusPill } from "../components";
import { EmptyState, ErrorNotice, Skeleton } from "../components/States";

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function RunsScreen() {
  const { runs, loading, error, refresh } = useRuns();

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Runs</h1>
          <p className="page-subtitle">Every processed interaction, with where it came from and what it produced.</p>
        </div>
      </header>

      {error != null && <ErrorNotice error={error} onRetry={() => void refresh()} />}

      {loading ? (
        <Skeleton rows={4} height={76} />
      ) : runs.length === 0 ? (
        <EmptyState title="No runs yet." hint="Process an interaction to see it here." />
      ) : (
        <ul className="run-list">
          {runs.map((r) => {
            const pending = r.proposals.filter((p) => p.status === "pending_approval").length;
            return (
              <li key={r.id}>
                <Link className="run-row" to={`/app/runs/${r.id}`}>
                  <div className="run-row-main">
                    <div className="run-row-title">
                      <span className={`source-badge source-${r.mode}`}>{r.mode === "integration" ? "Integration" : "Manual"}</span>
                      <span className="run-account">{r.accountId ?? "Unlinked account"}</span>
                      <StatusPill value={r.status} />
                    </div>
                    <div className="run-row-meta">
                      <span>{fmt(r.createdAt)}</span>
                      <span aria-hidden>·</span>
                      <span className="run-id" title={r.id}>
                        {r.id.slice(0, 8)}
                      </span>
                    </div>
                  </div>
                  <div className="run-row-stats">
                    <span className="mini-stat">
                      <b>{r.findings.length}</b> findings
                    </span>
                    <span className="mini-stat">
                      <b>{r.proposals.length}</b> proposals
                    </span>
                    {pending > 0 && <span className="tag tag-pending">{pending} awaiting approval</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
