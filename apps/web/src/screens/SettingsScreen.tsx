import { Card, Section } from "../components";

export function SettingsScreen() {
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
          <div className="kv"><span className="k">Current mode</span><span className="v">Sample Mode</span></div>
          <div className="kv"><span className="k">Commercial state</span><span className="v">Synthetic fixtures</span></div>
          <div className="kv"><span className="k">HubSpot / Gmail</span><span className="v">Not configured</span></div>
          <p className="helper">Sample Mode uses deterministic fixtures and requires no integrations. Switch to Live Mode after configuring credentials in the backend environment.</p>
        </Card>
      </Section>

      <Section title="Integrations">
        <Card>
          <div className="kv"><span className="k">HubSpot</span><span className="v">Not connected</span></div>
          <div className="kv"><span className="k">Gmail</span><span className="v">Not connected</span></div>
          <div className="kv"><span className="k">Commercial provider</span><span className="v">Synthetic</span></div>
        </Card>
      </Section>
    </>
  );
}
