import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { TuboMark } from "../../components/TuboMark";

/** Shared frame for every auth screen — same visual language as the app. */
export function AuthShell({
  title,
  lead,
  children,
  footer,
  emphasis,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
  footer?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="auth">
      <div className={`auth-card ${emphasis ? "auth-card-emphasis" : ""}`}>
        <Link to="/" className="auth-brand">
          <TuboMark size={26} />
          <span>
            <b>Tubo</b>
            <small>Revenue Execution OS</small>
          </span>
        </Link>
        <h1>{title}</h1>
        {lead && <p className="auth-lead">{lead}</p>}
        {children}
        {footer && <div className="auth-foot">{footer}</div>}
      </div>
    </div>
  );
}
