import { useState } from "react";
import { api, type AuditView } from "./api";
import { Button, Sidebar, Spinner } from "./components";
import { useRun } from "./hooks";
import type { RunView } from "./types";
import { ProcessScreen } from "./screens/ProcessScreen";
import { ReviewScreen } from "./screens/ReviewScreen";
import { RunsScreen } from "./screens/RunsScreen";
import { EvaluationScreen } from "./screens/EvaluationScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

export default function App() {
  const [view, setView] = useState("process");
  const [runId, setRunId] = useState<string | null>(null);
  const { run, setRun, loading, error } = useRun(runId);
  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState<AuditView | null>(null);

  function navigate(v: string) {
    setView(v);
    setRunId(null);
    setRun(null);
  }

  function onAnalyzed(r: RunView) {
    setRunId(r.id);
    setRun(r);
  }

  async function openAudit() {
    setAuditOpen(true);
    if (runId) setAudit(await api.getAudit(runId));
  }

  let content;
  if (run) {
    content = <ReviewScreen run={run} onUpdated={setRun} onAudit={openAudit} />;
  } else if (loading) {
    content = <div className="loading-block"><Spinner /> Loading run…</div>;
  } else if (error) {
    content = <div className="alert alert-error">{error}</div>;
  } else if (view === "runs") {
    content = <RunsScreen onOpen={(id) => setRunId(id)} />;
  } else if (view === "evaluation") {
    content = <EvaluationScreen />;
  } else if (view === "settings") {
    content = <SettingsScreen />;
  } else {
    content = <ProcessScreen onAnalyzed={onAnalyzed} />;
  }

  return (
    <div className="shell">
      <Sidebar active={run ? "process" : view} onNavigate={navigate} />
      <main className="main">{content}</main>

      {auditOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setAuditOpen(false)} />
          <div className="drawer">
            <div className="drawer-head">
              <h3>Audit trail</h3>
              <Button variant="ghost" onClick={() => setAuditOpen(false)}>Close</Button>
            </div>
            <div className="timeline">
              {(audit?.steps ?? ["Loading…"]).map((s, i) => (
                <div className="timeline-step" key={i}>
                  <div className="timeline-label">{s}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
