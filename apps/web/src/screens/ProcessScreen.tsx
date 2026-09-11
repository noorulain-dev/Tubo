import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { api } from "../api";
import type { RunView } from "../types";
import { ErrorNotice } from "../components/States";

const STAGES = [
  "Understanding interaction",
  "Checking account context",
  "Reconciling operational state",
  "Building recommendations",
];

export function ProcessScreen({ onAnalyzed }: { onAnalyzed: (run: RunView) => void }) {
  const [account, setAccount] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [transcript, setTranscript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    api
      .listHubspotCompanies()
      .then(({ companies: list }) => setCompanies(list))
      .catch(() => setCompanies([]));
  }, []);

  async function handleAnalyze() {
    if (!account.trim() || !transcript.trim()) {
      setValidation("Add an account and the interaction notes before processing.");
      return;
    }
    setValidation(null);
    setError(null);
    setLoading(true);
    try {
      const run = await api.processInteraction({ text: transcript, kind: "note", accountId: account, mode: "live" });
      onAnalyzed(run);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Process interaction</h1>
          <p className="page-subtitle">Turn a customer conversation into trusted operational state.</p>
        </div>
      </header>

      <div className="process-grid">
        <section className="process-main" aria-label="Interaction">
          <label className="field-label" htmlFor="transcript">
            Transcript or notes
          </label>
          <textarea
            id="transcript"
            className="process-textarea"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Paste the call transcript, meeting notes, or email body here…"
            disabled={loading}
          />
          {validation && (
            <p className="field-error" role="alert">
              {validation}
            </p>
          )}
          {error != null && <ErrorNotice error={error} />}

          <div className="process-actions">
            <button type="button" className="btn btn-primary" onClick={() => void handleAnalyze()} disabled={loading}>
              <Sparkles size={15} aria-hidden /> {loading ? "Processing…" : "Process interaction"}
            </button>
            <span className="process-note">Consequential changes always require your approval.</span>
          </div>

          {loading && (
            <ol className="process-stages" aria-live="polite">
              {STAGES.map((s) => (
                <li key={s} className="process-stage">
                  <span className="stage-dot" aria-hidden />
                  {s}
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="process-side" aria-label="Source and context">
          <div className="field">
            <label htmlFor="account">Account</label>
            <select id="account" className="plan-select" value={account} onChange={(e) => setAccount(e.target.value)} disabled={loading}>
              <option value="">Select an account…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="title">Interaction title</label>
            <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Renewal call" disabled={loading} />
          </div>
          <div className="field">
            <label htmlFor="date">Date</label>
            <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={loading} />
          </div>
        </aside>
      </div>
    </>
  );
}
