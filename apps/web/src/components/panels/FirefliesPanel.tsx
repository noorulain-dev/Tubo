import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Mic, RefreshCw } from "lucide-react";
import { api, type ConnectionStatus } from "../../api";
import type { RunView } from "../../types";
import { EmptyState, ErrorNotice, InfoNotice, Skeleton } from "../States";

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

interface RecentMeeting {
  title: string | null;
  startedAt: string | null;
}

export function FirefliesPanel() {
  const [conn, setConn] = useState<ConnectionStatus | null>(null);
  const [recent, setRecent] = useState<RecentMeeting[]>([]);
  const [meetingCount, setMeetingCount] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [key, setKey] = useState("");
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await api.getConnections();
      setConn(status);
      if (status.fireflies.connected) {
        const test = await api.testFireflies();
        setRecent(test.recent ?? []);
        setMeetingCount(test.meetingCount ?? null);
        setLastSync(new Date().toISOString());
      }
      setRuns(await api.listRuns());
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connected = conn?.fireflies.connected ?? false;

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      setConn(await api.connectFireflies(key));
      setKey("");
    } catch (e) {
      setError(e);
    } finally {
      setConnecting(false);
    }
  }
  const ingestedRuns = runs.filter((r) => r.mode === "integration");

  return (
    <div className="panel-body">
      <div className="panel-status">
        <span className={`integration-dot ${connected ? "connected" : ""}`} aria-hidden />
        <span>{connected ? "Connected" : "Not connected"}</span>
        <span className="panel-status-meta">{connected ? (lastSync ? `Checked ${fmt(lastSync)}` : "Not synced yet") : ""}</span>
        <button type="button" className="iconbtn" aria-label="Refresh Fireflies" onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden />
        </button>
      </div>

      <InfoNotice>
        Tubo does not ask Fireflies to join meetings. It only consumes transcripts from meetings Fireflies already processed.
      </InfoNotice>

      {loading ? (
        <Skeleton rows={3} height={56} />
      ) : error ? (
        <ErrorNotice error={error} onRetry={() => void load()} />
      ) : !connected ? (
        <div className="panel-connect">
          <div className="field">
            <label htmlFor="fireflies-key">Fireflies API key</label>
            <input
              id="fireflies-key"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Fireflies API key"
            />
          </div>
          <button type="button" className="btn btn-primary" disabled={!key.trim() || connecting} onClick={() => void connect()}>
            {connecting ? "Connecting…" : "Connect"}
          </button>
        </div>
      ) : (
        <>
          <section className="panel-section">
            <h4 className="panel-section-title">
              <Mic size={14} aria-hidden /> Recent meetings seen by Fireflies
              {meetingCount !== null && <span className="panel-count">{meetingCount}</span>}
            </h4>
            {recent.length === 0 ? (
              <EmptyState title="No processed meetings available." />
            ) : (
              <ul className="panel-list">
                {recent.slice(0, 8).map((m, i) => (
                  <li className="panel-item" key={`${m.title ?? "meeting"}-${i}`}>
                    <div className="panel-item-title">{m.title ?? "Untitled meeting"}</div>
                    <div className="panel-item-meta">
                      <span>{fmt(m.startedAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel-section">
            <h4 className="panel-section-title">Ingested into Tubo</h4>
            {ingestedRuns.length === 0 ? (
              <p className="panel-hint">No transcript has been processed into a Tubo run yet.</p>
            ) : (
              <ul className="panel-list">
                {ingestedRuns.slice(0, 6).map((r) => (
                  <li className="panel-item" key={r.id}>
                    <Link className="panel-item-title link" to={`/app/runs/${r.id}`}>
                      {r.accountId ?? "Unlinked account"}
                    </Link>
                    <div className="panel-item-meta">
                      <span>{fmt(r.createdAt)}</span>
                      <span className="tag tag-pending">{r.findings.length} findings</span>
                      <span className="tag tag-pending">{r.semantic?.confirmedCommitments.length ?? 0} commitments</span>
                      {(r.semantic?.blockers.length ?? 0) > 0 && <span className="tag tag-warn">{r.semantic?.blockers.length} blockers</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
