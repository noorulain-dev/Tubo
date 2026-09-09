import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  crashed: boolean;
}

/**
 * Top-level guard: a rendering error shows a designed state instead of a blank
 * white page. No stack traces are ever rendered for the user.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Developer-only signal; never surfaced in the UI.
    console.error("Unhandled UI error", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="crash-screen" role="alert">
        <div className="crash-card">
          <h1>Something went wrong on this screen.</h1>
          <p>Your data was not changed. Reloading usually clears this.</p>
          <div className="crash-actions">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload Tubo
            </button>
            <a className="btn btn-ghost" href="/app/command-center">
              Back to Command Center
            </a>
          </div>
        </div>
      </div>
    );
  }
}
