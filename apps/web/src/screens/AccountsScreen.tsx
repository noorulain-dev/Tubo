import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useCommandCenter } from "../hooks";
import { EmptyState, ErrorNotice, Skeleton } from "../components/States";

function relTime(iso: string | null): string {
  if (!iso) return "no activity";
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff)) return "no activity";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function AccountsScreen({ onOpenAccount }: { onOpenAccount: (accountId: string) => void }) {
  const { rows, loading, error } = useCommandCenter();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.identity?.name ?? ""} ${r.accountId} ${r.stage ?? ""} ${r.commercial ?? ""}`.toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Accounts</h1>
          <p className="page-subtitle">Every account with reconciled operational state.</p>
        </div>
        <div className="search-field">
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts, stage or commercial state"
            aria-label="Search accounts"
          />
        </div>
      </header>

      {error != null && <ErrorNotice error={error} />}

      {loading ? (
        <Skeleton rows={5} height={82} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={query ? "No accounts match that search." : "No accounts yet."}
          hint={query ? "Try a shorter search term." : "Process an interaction to create account state."}
        />
      ) : (
        <ul className="account-list">
          {filtered.map((r) => (
            <li key={r.accountId}>
              <button type="button" className="account-row" onClick={() => onOpenAccount(r.accountId)}>
                <div className="account-row-main">
                  <div className="account-row-title">
                    <span className="account-name">{r.identity?.name ?? r.accountId}</span>
                    {r.isAssessment && <span className="tag tag-muted">Test data</span>}
                    {r.highestSeverity && <span className={`sev-pill sev-${r.highestSeverity}`}>{r.highestSeverity}</span>}
                  </div>
                  <div className="account-row-meta">
                    <span>{r.stage ?? "No CRM stage"}</span>
                    <span aria-hidden>·</span>
                    <span>{r.commercial ?? "Commercial unverified"}</span>
                    <span aria-hidden>·</span>
                    <span>Last interaction {relTime(r.lastMeaningfulEventAt)}</span>
                  </div>
                </div>
                <div className="account-row-stats">
                  <span className="mini-stat">
                    <b>{r.openCommitments}</b> commitments
                  </span>
                  <span className="mini-stat">
                    <b>{r.openQuestions}</b> questions
                  </span>
                  <span className="mini-stat">
                    <b>{r.pendingCount}</b> pending
                  </span>
                  <span className={`attention ${r.blocked ? "blocked" : r.highestSeverity ? "needs" : "clear"}`}>
                    {r.blocked ? "Blocked" : r.highestSeverity ? "Needs attention" : "Reconciled"}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
