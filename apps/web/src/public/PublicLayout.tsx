import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { TuboMark } from "../components/TuboMark";

const NAV = [
  { to: "/features", label: "Features" },
  { to: "/case-study", label: "Case Study" },
  { to: "/ai-collaboration", label: "How I Built It" },
  { to: "/evaluation", label: "Evaluation" },
  { to: "/next", label: "What's Next" },
];

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="public">
      <header className="public-nav">
        <Link to="/" className="public-brand">
          <TuboMark size={26} />
          <span>
            <b>Tubo</b>
            <small>Revenue Execution OS</small>
          </span>
        </Link>
        <nav aria-label="Public">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `public-link ${isActive ? "active" : ""}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <Link className="btn btn-primary btn-sm" to="/app/command-center">
          Open App
        </Link>
      </header>
      <main className="public-main">{children}</main>
      <footer className="public-foot">
        <span>Tubo — Revenue Execution OS</span>
        <nav aria-label="Footer">
          <Link to="/privacy">Privacy</Link>
          <Link to="/case-study">Case study</Link>
          <Link to="/app/command-center">Open app</Link>
        </nav>
      </footer>
    </div>
  );
}

export function PublicArticle({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <PublicLayout>
      <article className="article">
        <header className="article-head">
          <h1>{title}</h1>
          {lead && <p className="article-lead">{lead}</p>}
        </header>
        {children}
      </article>
    </PublicLayout>
  );
}
