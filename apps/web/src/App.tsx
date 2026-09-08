import { useEffect, useState } from "react";
import { api, clearToken, getToken, setOnUnauthorized, type AuditView, type AuthUser } from "./api";
import { Button, Sidebar, Spinner } from "./components";
import { useRun } from "./hooks";
import type { RunView } from "./types";
import { ProcessScreen } from "./screens/ProcessScreen";
import { ReviewScreen } from "./screens/ReviewScreen";
import { RunsScreen } from "./screens/RunsScreen";
import { EvaluationScreen } from "./screens/EvaluationScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { CalendarDrawer } from "./screens/CalendarDrawer";
import { CommandCenterScreen } from "./screens/CommandCenterScreen";
import { AccountsScreen } from "./screens/AccountsScreen";
import { AccountScreen } from "./screens/AccountScreen";

export default function App() {
  const [view, setView] = useState("command-center");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const { run, setRun, loading, error } = useRun(runId);
  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState<AuditView | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      setAuthChecked(true);
      return;
    }
    api
      .me()
      .then(({ user: u }) => setUser(u))
      .catch(() => clearToken())
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => {
      setUser(null);
      setRun(null);
      setRunId(null);
      setAccountId(null);
      setView("command-center");
    });
    return () => setOnUnauthorized(null);
  }, []);

  function navigate(v: string) {
    setView(v);
    setAccountId(null);
    setRunId(null);
    setRun(null);
  }

  function openAccount(id: string) {
    setAccountId(id);
    setRunId(null);
    setRun(null);
    setView("account");
  }

  function onAnalyzed(r: RunView) {
    setRunId(r.id);
    setRun(r);
  }

  async function openAudit() {
    setAuditOpen(true);
    if (runId) setAudit(await api.getAudit(runId));
  }

  async function handleLogout() {
    await api.logout();
    setUser(null);
    setRun(null);
    setRunId(null);
    navigate("process");
  }

  if (!authChecked) {
    return (
      <div className="loading-block" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <Spinner /> Loading…
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onAuthed={setUser} />;
  }

  let content;
  if (run) {
    content = <ReviewScreen run={run} onUpdated={setRun} onAudit={openAudit} />;
  } else if (loading) {
    content = <div className="loading-block"><Spinner /> Loading run…</div>;
  } else if (error) {
    content = <div className="alert alert-error">{error}</div>;
  } else if (view === "command-center") {
    content = <CommandCenterScreen onOpenAccount={openAccount} />;
  } else if (view === "accounts") {
    content = <AccountsScreen onOpenAccount={openAccount} />;
  } else if (view === "account" && accountId) {
    content = <AccountScreen accountId={accountId} />;
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
      <Sidebar active={run ? "process" : view === "account" ? "accounts" : view} onNavigate={navigate} />
      <main className="main">
        <div className="user-bar">
          <span className="helper">{user.email}</span>
          <Button variant="secondary" onClick={() => setCalendarOpen(true)}>Calendar</Button>
          <Button variant="ghost" onClick={() => void handleLogout()}>Log out</Button>
        </div>
        {content}
      </main>

      <CalendarDrawer open={calendarOpen} onClose={() => setCalendarOpen(false)} />

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
