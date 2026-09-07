import { useEffect, useState } from "react";
import { api, type IntegrationsView } from "../api";
import { Button, Card, Section } from "../components";

interface IntegrationMeta {
  key: keyof Omit<IntegrationsView, "mode" | "live">;
  label: string;
  env: string[];
  instructions: string;
  link: string;
  linkLabel: string;
}

const INTEGRATIONS: IntegrationMeta[] = [
  {
    key: "llm",
    label: "LLM provider",
    env: ["OPENAI_API_KEY", "OPENAI_MODEL"],
    instructions: "Set an OpenAI-compatible API key in the backend .env to power Live Mode interpretation and reasoning.",
    link: "https://platform.openai.com/api-keys",
    linkLabel: "OpenAI API keys",
  },
  {
    key: "hubspot",
    label: "HubSpot",
    env: ["HUBSPOT_ACCESS_TOKEN"],
    instructions: "Create a private app access token and paste it into the backend .env. The system only reads companies, contacts, deals, tasks, and notes.",
    link: "https://developers.hubspot.com/docs/api/private-apps",
    linkLabel: "HubSpot private apps",
  },
  {
    key: "gmail",
    label: "Gmail",
    env: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"],
    instructions: "Create an OAuth 2.0 client and obtain a refresh token, then add all three values to the backend .env. Gmail is used to read threads and prepare draft replies.",
    link: "https://console.cloud.google.com/apis/credentials",
    linkLabel: "Google Cloud credentials",
  },
  {
    key: "stripe",
    label: "Stripe (commercial state)",
    env: ["STRIPE_SECRET_KEY"],
    instructions: "Add a Stripe secret key to the backend .env to source subscription/trial state authoritatively.",
    link: "https://dashboard.stripe.com/apikeys",
    linkLabel: "Stripe API keys",
  },
];

function StatusDot({ ok }: { ok: boolean }) {
  const color = ok ? "#16a34a" : "#9ca3af";
  return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, marginRight: 6 }} />;
}

export function SettingsScreen() {
  const [integrations, setIntegrations] = useState<IntegrationsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api
      .getIntegrations()
      .then(setIntegrations)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load integration status"));
  }, []);

  return (
    <>
      <div className="main-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">Environment and integration configuration.</div>
        </div>
      </div>

      <Section title="Mode">
        <Card>
          <div className="kv">
            <span className="k">Current mode</span>
            <span className="v">{integrations?.live ? "Live Mode available" : "Sample Mode"}</span>
          </div>
          <div className="kv">
            <span className="k">LLM provider</span>
            <span className="v">{integrations?.llm.provider ?? "—"}</span>
          </div>
          <p className="helper">
            Credentials are configured server-side in the backend <code>.env</code>. The frontend never handles OAuth or
            stores secrets; it only reflects live connection status.
          </p>
          {error && <div className="alert alert-error">{error}</div>}
        </Card>
      </Section>

      <Section title="Integrations">
        <Card>
          {INTEGRATIONS.map((row) => {
            const configured =
              row.key === "llm"
                ? integrations?.llm.configured ?? false
                : row.key === "hubspot"
                  ? integrations?.hubspot.configured ?? false
                  : row.key === "gmail"
                    ? integrations?.gmail.configured ?? false
                    : integrations?.stripe.configured ?? false;
            const isOpen = open === row.key;
            return (
              <div key={row.key} style={{ padding: "10px 0", borderBottom: "1px solid var(--border, #eee)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <StatusDot ok={configured} />
                    <span style={{ fontWeight: 600, marginRight: 8 }}>{row.label}</span>
                    <span className={configured ? "badge badge-green" : "badge"}>{configured ? "Connected" : "Not connected"}</span>
                  </div>
                  <Button variant={configured ? "ghost" : "primary"} onClick={() => setOpen(isOpen ? null : row.key)}>
                    {isOpen ? "Hide" : configured ? "Reconnect" : "Connect"}
                  </Button>
                </div>
                {isOpen && (
                  <div className="helper" style={{ marginTop: 8 }}>
                    <p>{row.instructions}</p>
                    <p>
                      <strong>Required env:</strong>{" "}
                      {row.env.map((e) => (
                        <code key={e} style={{ marginRight: 6 }}>
                          {e}
                        </code>
                      ))}
                    </p>
                    <a href={row.link} target="_blank" rel="noreferrer">
                      {row.linkLabel} →
                    </a>
                    <p style={{ marginTop: 8 }}>
                      After updating <code>.env</code>, restart the API server and this status will refresh on reload.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      </Section>
    </>
  );
}
