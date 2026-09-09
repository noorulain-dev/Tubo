import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { toFriendlyError, type FriendlyError } from "../lib/errors";

/** Skeleton block used while a real data surface is loading. */
export function Skeleton({ rows = 3, height = 64 }: { rows?: number; height?: number }) {
  return (
    <div className="skeleton-stack" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skeleton-block" key={i} style={{ height }} />
      ))}
    </div>
  );
}

export function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading-inline" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

/** Consistent inline/page-level error surface driven by backend error codes. */
export function ErrorNotice({
  error,
  onRetry,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const friendly: FriendlyError = typeof error === "object" && error !== null && "retryable" in (error as object)
    ? (error as FriendlyError)
    : toFriendlyError(error);
  return (
    <div className={`notice notice-error ${compact ? "notice-compact" : ""}`} role="alert">
      <AlertTriangle size={16} aria-hidden="true" />
      <div className="notice-body">
        <div className="notice-title">{friendly.message}</div>
        {friendly.hint && <div className="notice-hint">{friendly.hint}</div>}
        {friendly.requestId && <div className="notice-meta">Request ID {friendly.requestId}</div>}
      </div>
      {friendly.retryable && onRetry && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function InfoNotice({ children }: { children: ReactNode }) {
  return (
    <div className="notice notice-info">
      <Info size={16} aria-hidden="true" />
      <div className="notice-body">{children}</div>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  tone = "neutral",
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  tone?: "neutral" | "positive";
}) {
  return (
    <div className={`empty-state empty-${tone}`}>
      <span className="empty-state-icon" aria-hidden="true">
        {tone === "positive" ? <CheckCircle2 size={20} /> : <Info size={20} />}
      </span>
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
