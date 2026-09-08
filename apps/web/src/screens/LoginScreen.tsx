import { useState } from "react";
import { api, type AuthUser } from "../api";
import { Button, Card } from "../components";

export function LoginScreen({ onAuthed }: { onAuthed: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const result = mode === "login" ? await api.login(email, password) : await api.register(email, password);
      onAuthed(result.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <div style={{ width: 360 }}>
        <div className="brand" style={{ marginBottom: 16 }}>
          <div className="brand-mark">R</div>
          <div>
            <div className="brand-name">Revenue Execution OS</div>
            <div className="brand-tag">Sign in to continue</div>
          </div>
        </div>
        <Card>
          <div className="segmented" style={{ width: "100%", marginBottom: 16 }}>
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Sign in</button>
            <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Create account</button>
          </div>
          <div className="field">
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          {mode === "register" && <p className="helper">Password must be at least 8 characters.</p>}
          {error && <div className="alert alert-error">{error}</div>}
          <Button variant="primary" disabled={busy || !email.trim() || !password} onClick={() => void submit()}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </Card>
      </div>
    </div>
  );
}
