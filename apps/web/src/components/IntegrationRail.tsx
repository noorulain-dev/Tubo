import { useEffect, useState } from "react";
import { Calendar, LayoutGrid, Mail, Mic, X } from "lucide-react";
import { api, type ConnectionStatus } from "../api";
import { CalendarPanel } from "./CalendarPanel";
import { GmailPanel } from "./panels/GmailPanel";
import { HubspotPanel } from "./panels/HubspotPanel";
import { FirefliesPanel } from "./panels/FirefliesPanel";
import { useAccountContext } from "../lib/useAccountContext";

export type IntegrationProviderId = "calendar" | "gmail" | "hubspot" | "fireflies";

/** Simple inline provider marks (no external logo assets required). */
function HubspotMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="17.5" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="6" cy="6" r="2" fill="currentColor" />
      <circle cx="6" cy="18" r="2" fill="currentColor" />
      <path d="M7.6 7.2 13.8 10M7.6 16.8 13.8 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M17.5 8V4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

interface ProviderDef {
  id: IntegrationProviderId;
  label: string;
  render: (size: number) => JSX.Element;
}

const PROVIDERS: ProviderDef[] = [
  { id: "calendar", label: "Google Calendar", render: (s) => <Calendar size={s} aria-hidden /> },
  { id: "gmail", label: "Gmail", render: (s) => <Mail size={s} aria-hidden /> },
  { id: "hubspot", label: "HubSpot", render: (s) => <HubspotMark size={s} /> },
  { id: "fireflies", label: "Fireflies", render: (s) => <Mic size={s} aria-hidden /> },
];

function connectionOf(status: ConnectionStatus | null, id: IntegrationProviderId) {
  switch (id) {
    case "calendar":
      return status?.calendar;
    case "gmail":
      return status?.gmail;
    case "hubspot":
      return status?.hubspot;
    case "fireflies":
      return status?.fireflies;
  }
}

function stateLabel(status: ConnectionStatus | null, id: IntegrationProviderId): string {
  const c = connectionOf(status, id);
  if (!c) return "status unknown";
  if (c.needsReauth) return "needs reauthorisation";
  return c.connected ? "connected" : "not connected";
}

export function IntegrationRail() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [selected, setSelected] = useState<IntegrationProviderId | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const accountId = useAccountContext();

  useEffect(() => {
    api.getConnections().then(setStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggle(id: IntegrationProviderId) {
    setSelected((cur) => (cur === id ? null : id));
  }

  const activeProvider = selected ? PROVIDERS.find((p) => p.id === selected) ?? null : null;

  return (
    <>
      <aside className="integration-rail" aria-label="Integrations">
        {PROVIDERS.map((p) => {
          const c = connectionOf(status, p.id);
          const dotClass = c?.needsReauth ? "warn" : c?.connected ? "connected" : "";
          return (
            <button
              key={p.id}
              type="button"
              className={`integration-rail-btn ${selected === p.id ? "selected" : ""}`}
              data-tooltip={`${p.label} — ${stateLabel(status, p.id)}`}
              aria-label={`${p.label}, ${stateLabel(status, p.id)}`}
              aria-pressed={selected === p.id}
              aria-expanded={selected === p.id}
              onClick={() => toggle(p.id)}
            >
              {p.render(20)}
              <span className={`integration-dot ${dotClass}`} aria-hidden />
            </button>
          );
        })}
      </aside>

      <button
        type="button"
        className="integration-mobile-trigger"
        aria-label="Open integrations"
        onClick={() => setSheetOpen(true)}
      >
        <LayoutGrid size={20} aria-hidden />
      </button>

      {activeProvider && (
        <div className="integration-panel" role="dialog" aria-label={activeProvider.label}>
          <div className="integration-panel-head">
            <div className="integration-panel-title">
              {activeProvider.render(18)}
              <span>{activeProvider.label}</span>
            </div>
            <button type="button" className="iconbtn" aria-label="Close panel" onClick={() => setSelected(null)}>
              <X size={18} aria-hidden />
            </button>
          </div>
          {activeProvider.id === "calendar" && <CalendarPanel />}
          {activeProvider.id === "gmail" && <GmailPanel accountId={accountId} />}
          {activeProvider.id === "hubspot" && <HubspotPanel accountId={accountId} />}
          {activeProvider.id === "fireflies" && <FirefliesPanel />}
        </div>
      )}

      {sheetOpen && (
        <>
          <div className="sheet-backdrop" onClick={() => setSheetOpen(false)} />
          <div className="integration-sheet" role="dialog" aria-label="Integrations">
            <div className="integration-panel-head">
              <div className="integration-panel-title">
                <LayoutGrid size={18} aria-hidden />
                <span>Integrations</span>
              </div>
              <button type="button" className="iconbtn" aria-label="Close" onClick={() => setSheetOpen(false)}>
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="integration-sheet-list">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="integration-sheet-item"
                  onClick={() => {
                    setSelected(p.id);
                    setSheetOpen(false);
                  }}
                >
                  {p.render(18)}
                  <span>{p.label}</span>
                  <span className="integration-sheet-state">{stateLabel(status, p.id)}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
