import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { PublicLayout } from "./PublicLayout";

export function NotFoundPage() {
  return (
    <PublicLayout>
      <div className="notfound">
        <Compass size={30} aria-hidden />
        <h1>This page doesn't exist.</h1>
        <p>The link may be out of date, or the page moved somewhere else in Tubo.</p>
        <div className="hero-actions">
          <Link className="btn btn-primary" to="/">
            Back to home
          </Link>
          <Link className="btn btn-secondary" to="/app/command-center">
            Open the app
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
}
