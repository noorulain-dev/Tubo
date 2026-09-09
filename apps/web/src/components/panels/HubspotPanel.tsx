import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Building2, GitCompare } from "lucide-react";
import { api, type ConnectionStatus } from "../../api";
import type { AccountDetail } from "../../types";
import { EmptyState, ErrorNotice, Skeleton } from "../States";

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

type Alignment = { label: string; tone: "ok" | "warn" | "danger" | "muted"; reason: string };

/** Alignment is derived from findings Tubo already produced — not re-computed here. */
function alignmentOf(detail: AccountDetail | null): Alignment {
  if (!detail) return { label: "Unknown", tone: "muted", reason: "No account state loaded." };
  const open = detail.findings.filter((f) => f.status === "open");
  if (open.some((f) => f.type.includes("contradict"))) {
    return { label: "Contradictory", tone: "danger", reason: "CRM state conflicts with what the customer said." };
  }
  if (open.some((f) => f.type.includes("missing"))) {
    return { label: "Missing context", tone: "warn", reason: "Tubo could not verify part of the commercial state." };
  }
  if (open.some((f) => f.type.includes("stale"))) {
    return { label: "Stale", tone: "warn", reason: "CRM has not caught up with the latest interaction." };
  }
  if (open.length > 0) {
    return { label: "Needs attention", tone: "warn", reason: `${open.length} open finding${open.length === 1 ? "" : "s"} on this account.` };
  }
  return { label: "Aligned", tone: "ok", reason: "CRM matches the reconciled state." };
}

export function HubspotPanel({ accountId }: { accountId: string | null }) {
  const [conn, setConn] = useState<ConnectionStatus | null>(null);
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    api.getConnections().then(setConn).catch(() => setConn(null));
  }, []);

  useEffect(() => {
    if (!accountId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError(null);
    api.getAccountDetail(accountId).then(setDetail).catch(setError).finally(() => setLoading(false));
  }, [accountId]);

  const connected = conn?.hubspot.connected ?? false;

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      setConn(await api.connectHubspot(token));
      setToken("");
    } catch (e) {
      setError(e);
    } finally {
      setConnecting(false);
    }
  }
  const alignment = alignmentOf(detail);
  const recentActions = (detail?.plans ?? []).flatMap((p) =>
    p.actions.filter((a) => /crm|hubspot|deal|stage|company|contact/i.test(a.action.type + a.action.target)).map((a) => ({ ...a, createdAt: p.createdAt })),
  );

  return (
    <div className="panel-body">
      <div className="panel-status">
        <span className={`integration-dot ${connected ? "connected" : ""}`} aria-hidden />
        <span>{connected ? "Connected" : conn?.hubspot.needsReauth ? "Reauthorisation required" : "Not connected"}</span>
      </div>

      {!connected && (
        <div className="panel-connect">
          <div className="field">
            <label htmlFor="hubspot-token">HubSpot access token</label>
            <input
              id="hubspot-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="pat-…"
            />
          </div>
          <button type="button" className="btn btn-primary" disabled={!token.trim() || connecting} onClick={() => void connect()}>
            {connecting ? "Connecting…" : "Connect"}
          </button>
        </div>
      )}

      {!accountId ? (
        <EmptyState title="Open an account to see its CRM context" hint="Tubo shows the operational slice of HubSpot, not the whole CRM." />
      ) : loading ? (
        <Skeleton rows={3} height={56} />
      ) : error ? (
        <ErrorNotice error={error} />
      ) : (
        <>
          <section className="panel-section">
            <h4 className="panel-section-title">
              <Building2 size={14} aria-hidden /> Account
            </h4>
            <dl className="panel-kv">
              <div>
                <dt>Name</dt>
                <dd>{detail?.snapshot.identity?.name ?? accountId}</dd>
              </div>
              <div>
                <dt>CRM stage</dt>
                <dd>{detail?.snapshot.stage ?? "Not set"}</dd>
              </div>
              <div>
                <dt>Commercial</dt>
                <dd>{detail?.snapshot.commercial?.status ?? "Unverified"}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{detail?.snapshot.commercial?.provenance ?? "—"}</dd>
              </div>
              <div>
                <dt>Last refresh</dt>
                <dd>{fmt(detail?.snapshot.lastSourceRefresh)}</dd>
              </div>
            </dl>
          </section>

          <section className="panel-section">
            <h4 className="panel-section-title">
              <GitCompare size={14} aria-hidden /> Tubo alignment
            </h4>
            <div className={`alignment alignment-${alignment.tone}`}>
              <span className="alignment-label">{alignment.label}</span>
              <span className="alignment-reason">{alignment.reason}</span>
            </div>
          </section>

          <section className="panel-section">
            <h4 className="panel-section-title">
              <Activity size={14} aria-hidden /> Recent Tubo actions
            </h4>
            {recentActions.length === 0 ? (
              <p className="panel-hint">No CRM action has been proposed for this account.</p>
            ) : (
              <ul className="panel-list">
                {recentActions.slice(0, 6).map((a) => (
                  <li className="panel-item" key={a.actionId}>
                    <div className="panel-item-title">{a.action.type.replace(/[._]/g, " ")}</div>
                    <div className="panel-item-meta">
                      <span>{a.action.target}</span>
                      <span className={`tag tag-${a.status === "executed" ? "ok" : "pending"}`}>{a.status.replace(/_/g, " ")}</span>
                      <span>{fmt(a.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Link className="panel-link" to={`/app/accounts/${accountId}`}>
            Open full account
          </Link>
        </>
      )}
    </div>
  );
}
