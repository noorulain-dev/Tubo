import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type { Classification, Mode, RiskLevel, RunStatus } from "./types";

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const { children, onClick, variant = "secondary", disabled, type = "button" } = props;
  return (
    <button type={type} className={`btn btn-${variant}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Card(props: { children: ReactNode; className?: string }) {
  return <div className={`card ${props.className ?? ""}`}>{props.children}</div>;
}

export function Section(props: { title?: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="section">
      {(props.title || props.action) && (
        <div className="section-head">
          <div>
            {props.title && <h3 className="section-title">{props.title}</h3>}
            {props.subtitle && <p className="section-subtitle">{props.subtitle}</p>}
          </div>
          {props.action}
        </div>
      )}
      {props.children}
    </section>
  );
}

const CLASS_BADGE: Record<Classification, string> = {
  missing: "badge-amber",
  duplicate: "badge-blue",
  contradictory: "badge-red",
  stale: "badge-orange",
  ambiguous: "badge-yellow",
  unsafe: "badge-red",
  aligned: "badge-green",
};

export function ClassificationBadge({ value }: { value: Classification }) {
  return <span className={`badge ${CLASS_BADGE[value]}`}>{value}</span>;
}

export function RiskBadge({ value }: { value: RiskLevel }) {
  const map: Record<RiskLevel, string> = { low: "badge-green", medium: "badge-amber", high: "badge-orange", critical: "badge-red" };
  return <span className={`badge ${map[value]}`}>{value} risk</span>;
}

export function SeverityBadge({ value }: { value: string | null }) {
  if (!value) return <span className="badge badge-muted">none</span>;
  const map: Record<string, string> = { low: "badge-green", medium: "badge-amber", high: "badge-orange", critical: "badge-red" };
  return <span className={`badge ${map[value] ?? "badge-muted"}`}>{value}</span>;
}

export function TestDataBadge() {
  return <span className="badge badge-muted" title="Synthetic [ASSESSMENT] record">Test data</span>;
}

export function StatusPill({ value }: { value: RunStatus }) {
  const label: Record<RunStatus, string> = {
    created: "Created",
    processing: "Processing",
    needs_review: "Needs review",
    done: "Done",
    failed: "Failed",
  };
  return <span className={`pill pill-${value}`}>{label[value]}</span>;
}

export function ModePill({ value }: { value: Mode }) {
  return <span className={`pill ${value === "sample" ? "pill-sample" : "pill-live"}`}>{value === "sample" ? "Sample Mode" : "Live Mode"}</span>;
}

export function SummaryCard(props: { label: string; value: number; tone: "neutral" | "warn" | "danger" | "accent" }) {
  return (
    <div className={`summary-card summary-${props.tone}`}>
      <span className="summary-value">{props.value}</span>
      <span className="summary-label">{props.label}</span>
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="loading" />;
}

export function EmptyState(props: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="empty-title">{props.title}</div>
      {props.hint && <div className="empty-hint">{props.hint}</div>}
    </div>
  );
}

export function Sidebar() {
  const items: { to: string; label: string; group: string }[] = [
    { to: "/app/command-center", label: "Command Center", group: "Overview" },
    { to: "/app/accounts", label: "Accounts", group: "Overview" },
    { to: "/app/process", label: "Process Interaction", group: "Overview" },
    { to: "/app/runs", label: "Runs", group: "Overview" },
    { to: "/app/evaluation", label: "Evaluation", group: "Insights" },
    { to: "/app/settings", label: "Settings", group: "System" },
  ];
  let lastGroup = "";
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <img src="/image.png" alt="Tubo" />
        </div>
        <div>
          <div className="brand-name">Tubo</div>
          <div className="brand-tag">Revenue Execution OS</div>
        </div>
      </div>
      <nav className="nav">
        {items.map((it) => {
          const header = it.group !== lastGroup ? <div className="nav-group">{it.group}</div> : null;
          lastGroup = it.group;
          return (
            <div key={it.to}>
              {header}
              <NavLink to={it.to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
                {it.label}
              </NavLink>
            </div>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <span className="dot" /> Assessment environment
      </div>
    </aside>
  );
}
