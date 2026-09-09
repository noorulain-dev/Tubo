import { useEffect, useState } from "react";
import { Building2, Calendar, LayoutGrid, Mail, Mic, X } from "lucide-react";
import { api, type ConnectionStatus } from "../api";
import { CalendarPanel } from "./CalendarPanel";

export type IntegrationProviderId = "calendar" | "gmail" | "hubspot" | "fireflies";

interface ProviderDef {
  id: IntegrationProviderId;
  label: string;
  Icon: typeof Calendar;
}

const PROVIDERS: ProviderDef[] = [
  { id: "calendar", label: "Google Calendar", Icon: Calendar },
  { id: "gmail", label: "Gmail", Icon: Mail },
  { id: "hubspot", label: "HubSpot", Icon: Building2 },
  { id: "fireflies", label: "Fireflies", Icon: Mic },
];

function isConnected(status: ConnectionStatus | null, id: IntegrationProviderId): boolean {
  switch (id) {
    case "calendar":
      return status?.calendar.connected ?? false;
    case "gmail":
      return status?.gmail.connected ?? false;
    case "hubspot":
      return status?.hubspot.connected ?? false;
    case "fireflies":
      return status?.fireflies.connected ?? false;
  }
}

export function IntegrationRail() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [selected, setSelected] = useState<IntegrationProviderId | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    api
      .getConnections()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  function toggle(id: IntegrationProviderId) {
    setSelected((cur) => (cur === id ? null : id));
  }

  const activeProvider = selected ? PROVIDERS.find((p) => p.id === selected) ?? null : null;

  return (
    <>
      {/* Desktop: thin rail */}
      <aside className="integration-rail" aria-label="Integrations">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`integration-rail-btn ${selected === p.id ? "selected" : ""}`}
            data-tooltip={p.label}
            aria-label={`${p.label}${isConnected(status, p.id) ? " (connected)" : " (not connected)"}`}
            aria-pressed={selected === p.id}
            onClick={() => toggle(p.id)}
          >
            <p.Icon size={20} aria-hidden />
            <span
              className={`integration-dot ${isConnected(status, p.id) ? "connected" : ""}`}
              aria-hidden
            />
          </button>
        ))}
      </aside>

      {/* Mobile/tablet: floating trigger (opens a bottom sheet) */}
      <button
        type="button"
        className="integration-mobile-trigger"
        aria-label="Open integrations"
        onClick={() => setSheetOpen(true)}
      >
        <LayoutGrid size={20} aria-hidden />
      </button>

      {/* Side panel (desktop slide-in / mobile bottom sheet via CSS) */}
      {activeProvider && (
        <div className="integration-panel" role="dialog" aria-label={activeProvider.label}>
          <div className="integration-panel-head">
            <div className="integration-panel-title">
              <activeProvider.Icon size={18} aria-hidden />
              <span>{activeProvider.label}</span>
            </div>
            <button type="button" className="iconbtn" aria-label="Close" onClick={() => setSelected(null)}>
              <X size={18} aria-hidden />
            </button>
          </div>
          {activeProvider.id === "calendar" ? (
            <CalendarPanel />
          ) : (
            <div className="integration-panel-body">
              <div className="integration-panel-status">
                <span className={`integration-dot ${isConnected(status, activeProvider.id) ? "connected" : ""}`} aria-hidden />
                <span>{isConnected(status, activeProvider.id) ? "Connected" : "Not connected"}</span>
              </div>
              <p className="helper">The {activeProvider.label} panel will appear here.</p>
            </div>
          )}
        </div>
      )}

      {/* Mobile/tablet: integration chooser sheet */}
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
                  <p.Icon size={18} aria-hidden />
                  <span>{p.label}</span>
                  <span
                    className={`integration-dot ${isConnected(status, p.id) ? "connected" : ""}`}
                    aria-hidden
                    style={{ marginLeft: "auto" }}
                  />
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}