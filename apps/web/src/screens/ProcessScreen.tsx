import { useEffect, useState } from "react";
import { api } from "../api";
import { Button, Card, Spinner } from "../components";
import type { RunView } from "../types";

export function ProcessScreen({ onAnalyzed }: { onAnalyzed: (run: RunView) => void }) {
  const [mode, setMode] = useState<"sample" | "live">("sample");
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [healthChecked, setHealthChecked] = useState(false);
  const [account, setAccount] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [transcript, setTranscript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getHealth()
      .then((h) => {
        setLiveAvailable(h.liveAvailable);
        setHealthChecked(true);
      })
      .catch(() => setHealthChecked(true));
  }, []);

  async function handleAnalyze() {
    if (!account.trim() || !transcript.trim()) {
      setError("Account and interaction notes are required.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const run = await api.processInteraction({ text: transcript, kind: "note", accountId: account, mode });
      onAnalyzed(run);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to process interaction");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="main-header">
        <div>
          <div className="page-title">Process interaction</div>
          <div className="page-subtitle">Turn a customer conversation into trusted operational state.</div>
        </div>
      </div>

      <Card>
        <div className="field" style={{ maxWidth: 320 }}>
          <label>Mode</label>
          <div className="segmented">
            <button className={mode === "sample" ? "active" : ""} onClick={() => setMode("sample")}>Sample Mode</button>
            <button
              className={mode === "live" ? "active" : ""}
              disabled={!liveAvailable}
              title={!liveAvailable ? "Live Mode is not configured on the server" : ""}
              onClick={() => setMode("live")}
            >
              Live Mode
            </button>
          </div>
          {healthChecked && !liveAvailable && (
            <p className="helper">Live Mode is unavailable — the server has no live LLM/integration configured. Running Sample Mode only.</p>
          )}
        </div>

        <div className="field-row">
          <div className="field">
            <label>Account</label>
            <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="e.g. demo_stale" />
          </div>
          <div className="field">
            <label>Interaction title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Renewal call" />
          </div>
        </div>

        <div className="field">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div className="field">
          <label>Transcript / notes</label>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Paste the call transcript, meeting notes, or email body here…"
          />
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <Button variant="primary" onClick={handleAnalyze} disabled={loading}>
          {loading ? <Spinner /> : null} Analyze Interaction
        </Button>

        <p className="helper">
          Revenue Execution OS compares this interaction against CRM, communication and commercial state.
          Consequential changes require your approval.
        </p>
      </Card>
    </>
  );
}
