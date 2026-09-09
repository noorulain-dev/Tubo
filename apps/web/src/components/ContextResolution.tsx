import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, HelpCircle, Lock, X } from "lucide-react";
import type { ContextChoice, ContextGap, ContextResolutionRecord } from "../types";

/**
 * "Needs context" — the human-in-the-loop repair surface.
 *
 * Three questions are always answered before asking anything:
 *   1. What Tubo knows
 *   2. What Tubo could not verify
 *   3. What input is needed to continue
 *
 * Answers are picked from candidates the backend found in real data, or a real
 * calendar date, or "leave unresolved". There is no free-text fact entry, and
 * saving never approves or executes anything.
 */

export const GAP_LABEL: Record<ContextGap["type"], string> = {
  ambiguous_account: "Account",
  ambiguous_contact: "Contact",
  missing_owner: "Owner",
  missing_deadline: "Deadline",
  missing_deal: "Deal",
  missing_commercial_authority: "Commercial authority",
  unavailable_source: "Source",
  incomplete_evidence: "Evidence",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function NeedsContextBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="tag tag-context">
      <HelpCircle size={12} aria-hidden /> Needs context{count > 1 ? ` · ${count}` : ""}
    </span>
  );
}

/** Inline card shown under the finding/commitment the gap belongs to. */
export function NeedsContextCard({
  gap,
  resolution,
  onOpen,
}: {
  gap: ContextGap;
  resolution?: ContextResolutionRecord;
  onOpen: (gap: ContextGap) => void;
}) {
  return (
    <article className={`context-card${gap.resolvable ? "" : " context-card-locked"}`}>
      <div className="context-card-head">
        <span className="tag tag-context">
          <HelpCircle size={12} aria-hidden /> Needs context
        </span>
        <span className="context-kind">{GAP_LABEL[gap.type]}</span>
        {gap.blocksExecution && <span className="tag tag-muted">Execution held</span>}
      </div>

      <h4 className="context-question">{gap.question}</h4>
      <p className="context-subject">{gap.subject.label}</p>

      <div className="context-facts">
        <div>
          <h5>What Tubo knows</h5>
          <ul>
            {gap.known.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </div>
        <div>
          <h5>What Tubo could not verify</h5>
          <ul>
            {gap.unverified.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </div>
      </div>

      <p className="context-needed">
        <ArrowRight size={13} aria-hidden /> {gap.needed}
      </p>

      {resolution && (
        <p className="context-resolved">
          <CheckCircle2 size={13} aria-hidden /> Resolved by {resolution.resolvedByName ?? "a teammate"} · {fmtTime(resolution.resolvedAt)} ·{" "}
          <strong>{resolution.selectedLabel}</strong>
        </p>
      )}

      {gap.resolvable ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpen(gap)}>
          Resolve
        </button>
      ) : (
        <div className="context-locked">
          <p>
            <Lock size={13} aria-hidden /> {gap.notResolvableReason}
          </p>
          {gap.cta && (
            <a className="btn btn-secondary btn-sm" href={gap.cta.href}>
              {gap.cta.label}
            </a>
          )}
        </div>
      )}
    </article>
  );
}

/** Compact right-side sheet — deliberately not a full-screen modal flow. */
export function ContextResolutionSheet({
  gap,
  saving,
  error,
  onClose,
  onSave,
}: {
  gap: ContextGap | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (gapId: string, choice: ContextChoice) => Promise<unknown>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [unresolved, setUnresolved] = useState(false);

  useEffect(() => {
    setSelected(null);
    setDate("");
    setUnresolved(false);
  }, [gap?.gapId]);

  useEffect(() => {
    if (!gap) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gap, onClose]);

  if (!gap) return null;

  const choice: ContextChoice | null = unresolved
    ? { kind: "unresolved" }
    : date
      ? { kind: "date", date }
      : selected
        ? { kind: "option", optionId: selected }
        : null;

  return (
    <div className="context-sheet" role="dialog" aria-modal="false" aria-label={gap.question}>
      <header className="context-sheet-head">
        <div>
          <span className="tag tag-context">
            <HelpCircle size={12} aria-hidden /> Needs context
          </span>
          <h3>{gap.question}</h3>
          <p className="context-subject">{gap.subject.label}</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={16} aria-hidden />
        </button>
      </header>

      <div className="context-sheet-body">
        <section className="context-facts">
          <div>
            <h5>What Tubo knows</h5>
            <ul>
              {gap.known.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ul>
          </div>
          <div>
            <h5>What Tubo could not verify</h5>
            <ul>
              {gap.unverified.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </div>
        </section>

        <h5 className="context-input-title">{gap.needed}</h5>

        <div className="context-options" role="radiogroup" aria-label={gap.needed}>
          {gap.options.map((o) => (
            <label key={o.optionId} className={`context-option${selected === o.optionId && !unresolved && !date ? " is-selected" : ""}`}>
              <input
                type="radio"
                name={`gap-${gap.gapId}`}
                checked={selected === o.optionId && !unresolved && !date}
                onChange={() => {
                  setSelected(o.optionId);
                  setUnresolved(false);
                  setDate("");
                }}
              />
              <span>
                <span className="context-option-label">{o.label}</span>
                {o.detail && <span className="context-option-detail">{o.detail}</span>}
                <span className="context-option-origin">from {o.origin.replace(/_/g, " ")}</span>
              </span>
            </label>
          ))}

          {gap.allowDate && (
            <label className={`context-option${date ? " is-selected" : ""}`}>
              <input type="radio" name={`gap-${gap.gapId}`} checked={Boolean(date) && !unresolved} onChange={() => setUnresolved(false)} />
              <span>
                <span className="context-option-label">Choose a specific date</span>
                <input
                  type="date"
                  className="context-date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setSelected(null);
                    setUnresolved(false);
                  }}
                />
              </span>
            </label>
          )}

          {gap.allowLeaveUnresolved && (
            <label className={`context-option${unresolved ? " is-selected" : ""}`}>
              <input
                type="radio"
                name={`gap-${gap.gapId}`}
                checked={unresolved}
                onChange={() => {
                  setUnresolved(true);
                  setSelected(null);
                  setDate("");
                }}
              />
              <span>
                <span className="context-option-label">
                  {gap.type === "missing_deadline" ? "There is no deadline" : "Leave unresolved"}
                </span>
                <span className="context-option-detail">
                  Safe: Tubo keeps the gap visible and will not act on this until it is answered.
                </span>
              </span>
            </label>
          )}
        </div>

        {gap.options.length === 0 && !gap.allowDate && (
          <p className="context-empty">
            <AlertTriangle size={13} aria-hidden /> Tubo found no candidates in your connected data. It will not invent one.
          </p>
        )}

        {error && <p className="context-error">{error}</p>}

        <p className="context-note">
          Your answer is recorded as human-supplied and never rewritten into the original conversation. Saving re-runs this account's
          reconciliation only — it does not approve or send anything.
        </p>
      </div>

      <footer className="context-sheet-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!choice || saving}
          onClick={() => {
            if (choice) void onSave(gap.gapId, choice).then(onClose).catch(() => undefined);
          }}
        >
          {saving ? "Saving…" : "Save & Reconcile"}
        </button>
      </footer>
    </div>
  );
}
