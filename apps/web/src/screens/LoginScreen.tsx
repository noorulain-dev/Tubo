import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type AuthUser } from "../api";
import { AuthShell } from "./auth/AuthShell";
import { ErrorNotice } from "../components/States";

export function LoginScreen({ onAuthed, mode = "login" }: { onAuthed: (user: AuthUser) => void; mode?: "login" | "register" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isRegister = mode === "register";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setValidation("Enter your email and password.");
      return;
    }
    if (isRegister && password.length < 8) {
      setValidation("Password must be at least 8 characters.");
      return;
    }
    setValidation(null);
    setError(null);
    setBusy(true);
    try {
      const result = isRegister ? await api.register(email, password) : await api.login(email, password);
      onAuthed(result.user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={isRegister ? "Create your Tubo account" : "Sign in to Tubo"}
      lead={isRegister ? "One account for reconciled revenue state across your stack." : "Pick up where your accounts left off."}
      footer={
        isRegister ? (
          <span>
            Already have an account? <Link to="/login">Sign in</Link>
          </span>
        ) : (
          <span>
            New here? <Link to="/signup">Create an account</Link> · <Link to="/forgot-password">Forgot password?</Link>
          </span>
        )
      }
    >
      <form onSubmit={(e) => void submit(e)} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          {isRegister && <p className="field-hint">At least 8 characters.</p>}
        </div>
        {validation && (
          <p className="field-error" role="alert">
            {validation}
          </p>
        )}
        {error != null && <ErrorNotice error={error} />}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}
