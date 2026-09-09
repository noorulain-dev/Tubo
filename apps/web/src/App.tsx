import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { api, clearToken, getToken, setOnUnauthorized, type AuditView, type AuthUser } from "./api";
import { Button, Sidebar, Spinner } from "./components";
import { IntegrationRail } from "./components/IntegrationRail";
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
import { PublicScreen } from "./screens/PublicScreen";

interface LayoutContext {
  openAudit: (runId: string) => Promise<void>;
  evaluator: boolean;
}

function AppLayout({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const location = useLocation();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState<AuditView | null>(null);

  if (!user) {
    return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  async function openAudit(runId: string) {
    setAuditOpen(true);
    setAudit(await api.getAudit(runId));
  }

  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <div className="user-bar">
          <span className="helper">{user.email}</span>
          <Button variant="secondary" onClick={() => setCalendarOpen(true)}>Calendar</Button>
          <Button variant="ghost" onClick={() => void onLogout()}>Log out</Button>
        </div>
        <Outlet context={{ openAudit, evaluator: !!user.evaluator }} />
      </main>
      <IntegrationRail />

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

function AccountPage() {
  const { accountId } = useParams<{ accountId: string }>();
  return <AccountScreen accountId={accountId ?? ""} />;
}

function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const { openAudit, evaluator } = useOutletContext<LayoutContext>();
  const { run, setRun, loading, error } = useRun(runId ?? null);

  if (loading) return <div className="loading-block"><Spinner /> Loading run…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!run) return <div className="alert alert-error">Run not found.</div>;
  return <ReviewScreen run={run} onUpdated={setRun} onAudit={() => openAudit(run.id)} externalExecutionDisabled={evaluator} />;
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

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
    setOnUnauthorized(() => setUser(null));
    return () => setOnUnauthorized(null);
  }, []);

  async function handleLogout() {
    await api.logout();
    setUser(null);
    navigate("/login");
  }

  function onAuthed(u: AuthUser) {
    setUser(u);
    const returnTo = new URLSearchParams(location.search).get("returnTo");
    navigate(returnTo && returnTo.startsWith("/") ? returnTo : "/app/command-center", { replace: true });
  }

  if (!authChecked) {
    return (
      <div className="loading-block" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <Spinner /> Loading…
      </div>
    );
  }

  const layout = user ? (
    <AppLayout user={user} onLogout={handleLogout} />
  ) : (
    <Navigate to="/login" replace />
  );

  const openAccount = (id: string) => navigate(`/app/accounts/${id}`);
  const openRun = (id: string) => navigate(`/app/runs/${id}`);

  return (
    <Routes>
      {/* Public marketing / auth */}
      <Route
        path="/"
        element={
          <PublicScreen
            title="Turn customer conversations into trusted operational state."
            cta={{ label: "Open Demo Workspace", to: "/login" }}
          />
        }
      />
      <Route path="/login" element={<LoginScreen onAuthed={onAuthed} />} />
      <Route path="/signup" element={<LoginScreen onAuthed={onAuthed} />} />
      <Route path="/verify-email" element={<PublicScreen title="Verify your email" subtitle="Check your inbox for a confirmation link." />} />
      <Route path="/forgot-password" element={<PublicScreen title="Forgot password" subtitle="Enter your email to request a reset link." />} />
      <Route path="/reset-password" element={<PublicScreen title="Reset password" subtitle="Choose a new password." />} />
      <Route path="/case-study" element={<PublicScreen title="Case study" />} />
      <Route path="/ai-collaboration" element={<PublicScreen title="AI collaboration" />} />
      <Route path="/next" element={<PublicScreen title="What's next" />} />

      {/* Authenticated */}
      <Route path="/app" element={<Navigate to="/app/command-center" replace />} />
      <Route element={layout}>
        <Route path="/app/command-center" element={<CommandCenterScreen onOpenAccount={openAccount} />} />
        <Route path="/app/accounts" element={<AccountsScreen onOpenAccount={openAccount} />} />
        <Route path="/app/accounts/:accountId" element={<AccountPage />} />
        <Route path="/app/process" element={<ProcessScreen onAnalyzed={(r: RunView) => openRun(r.id)} />} />
        <Route path="/app/runs" element={<RunsScreen />} />
        <Route path="/app/runs/:runId" element={<RunPage />} />
        <Route path="/app/evaluation" element={<EvaluationScreen />} />
        <Route path="/app/settings" element={<SettingsScreen />} />
      </Route>

      {/* 404 */}
      <Route path="*" element={<PublicScreen title="Not found" subtitle="This page does not exist." />} />
    </Routes>
  );
}
