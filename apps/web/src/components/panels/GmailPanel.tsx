import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Inbox, Mail, ShieldCheck } from "lucide-react";
import { api, type ConnectionStatus } from "../../api";
import type { AccountDetail } from "../../types";
import { EmptyState, ErrorNotice, InfoNotice, Skeleton } from "../States";

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const EMAIL_SOURCES = ["gmail", "email", "mail"];

/**
 * Tubo-relevant communication only — never a second inbox. Every row is derived
 * from state Tubo already reconciled for the account in context.
 */
export function GmailPanel({ accountId }: { accountId: string | null }) {
  const [conn, setConn] = useState<ConnectionStatus | null>(null);
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

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
    api
      .getAccountDetail(accountId)
      .then(setDetail)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [accountId]);

  const connected = conn?.gmail.connected ?? false;
  const needsReauth = conn?.gmail.needsReauth ?? false;

  const emailEvents = (detail?.recentEvents ?? []).filter((e) =>
    EMAIL_SOURCES.some((s) => (e.source ?? "").toLowerCase().includes(s) || e.eventType.toLowerCase().includes(s)),
  );
  const evidenceCommitments = (detail?.snapshot.commitments ?? []).filter((c) => c.relatedEmailIds.length > 0);
  const drafts = (detail?.plans ?? []).flatMap((plan) =>
    plan.actions
      .filter((a) => /email|draft|reply/i.test(a.action.type))
      .map((a) => ({ planId: plan.planId, actionId: a.actionId, type: a.action.type, target: a.action.target, status: a.status, createdAt: plan.createdAt })),
  );

  return (
    <div className="panel-body">
      <div className="panel-status">
        <span className={`integration-dot ${connected ? "connected" : ""}`} aria-hidden />
        <span>{connected ? "Connected" : needsReauth ? "Reauthorisation required" : "Not connected"}</span>
      </div>

      {!connected && (
        <InfoNotice>
          <strong>Gmail access is user-authorised.</strong>
          <p>
            Google OAuth for this project is currently limited to approved testing accounts, so evaluators do not need to
            connect a personal inbox. Everything Tubo needs for this assessment runs on synthetic workspace data.
          </p>
        </InfoNotice>
      )}

      {!accountId ? (
        <EmptyState
          title="Open an account to see its communication"
          hint="Tubo shows only the email context it used as evidence — never your whole inbox."
        />
      ) : loading ? (
        <Skeleton rows={3} height={56} />
      ) : error ? (
        <ErrorNotice error={error} onRetry={() => accountId && api.getAccountDetail(accountId).then(setDetail).catch(setError)} />
      ) : (
        <>
          <section className="panel-section">
            <h4 className="panel-section-title">
              <Inbox size={14} aria-hidden /> Recent relevant communication
            </h4>
            {emailEvents.length === 0 ? (
              <EmptyState title="No email evidence on this account yet." />
            ) : (
              <ul className="panel-list">
                {emailEvents.slice(0, 8).map((e) => (
                  <li className="panel-item" key={e.eventId}>
                    <div className="panel-item-title">{e.eventType.replace(/[._]/g, " ")}</div>
                    <div className="panel-item-meta">
                      <span>{e.source ?? "email"}</span>
                      <span>{fmt(e.occurredAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel-section">
            <h4 className="panel-section-title">
              <ShieldCheck size={14} aria-hidden /> Used as evidence
            </h4>
            {evidenceCommitments.length === 0 ? (
              <p className="panel-hint">No commitment on this account currently cites an email.</p>
            ) : (
              <ul className="panel-list">
                {evidenceCommitments.slice(0, 6).map((c) => (
                  <li className="panel-item" key={c.id}>
                    <div className="panel-item-title">{c.description}</div>
                    <div className="panel-item-meta">
                      <span className="tag tag-evidence">
                        <Mail size={11} aria-hidden /> {c.relatedEmailIds.length} email{c.relatedEmailIds.length === 1 ? "" : "s"}
                      </span>
                      <span>{c.status}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel-section">
            <h4 className="panel-section-title">
              <FileText size={14} aria-hidden /> Drafts created through Tubo
            </h4>
            {drafts.length === 0 ? (
              <p className="panel-hint">Tubo has not prepared any email for this account.</p>
            ) : (
              <ul className="panel-list">
                {drafts.slice(0, 6).map((d) => (
                  <li className="panel-item" key={d.actionId}>
                    <div className="panel-item-title">{d.type.replace(/[._]/g, " ")}</div>
                    <div className="panel-item-meta">
                      <span>{d.target}</span>
                      <span className={`tag tag-${d.status === "executed" ? "ok" : "pending"}`}>{d.status.replace(/_/g, " ")}</span>
                      <span>{fmt(d.createdAt)}</span>
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
