import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components";
import { TuboMark } from "../components/TuboMark";

/** Generic public page (marketing / auth helper) — a placeholder for now. */
export function PublicScreen({
  title,
  subtitle,
  children,
  cta,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  cta?: { label: string; to: string };
}) {
  return (
    <div className="shell" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <div style={{ width: 460 }}>
        <div className="brand" style={{ marginBottom: 16 }}>
          <div className="brand-mark">
            <TuboMark size={22} />
          </div>
          <div>
            <div className="brand-name">Tubo</div>
            <div className="brand-tag">Revenue Execution OS</div>
          </div>
        </div>
        <Card>
          <h2 style={{ marginTop: 0 }}>{title}</h2>
          {subtitle && <p className="helper">{subtitle}</p>}
          {children}
          {cta && (
            <div style={{ marginTop: 16 }}>
              <Link to={cta.to} className="btn btn-primary" style={{ textDecoration: "none", display: "inline-block" }}>
                {cta.label}
              </Link>
            </div>
          )}
        </Card>
        <p style={{ textAlign: "center", marginTop: 16 }}>
          <Link to="/login" className="helper">Sign in</Link>
        </p>
      </div>
    </div>
  );
}