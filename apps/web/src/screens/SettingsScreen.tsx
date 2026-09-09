import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api, type ConnectionStatus } from "../api";
import { Button, Card, Section } from "../components";

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span className={connected ? "badge badge-green" : "badge"}>
      {connected ? "Connected" : "Not connected"}
    </span>
  );
}

export function SettingsScreen() {
  const { evaluator } = useOutletContext<{ evaluator: boolean }>();
  const [connections, setConnections] = useState<ConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stripeKey, setStripeKey] = useState("");
  const [hubspotToken, setHubspotToken] = useState("");
  const [firefliesKey, setFirefliesKey] = useState("");
  const [firefliesInfo, setFirefliesInfo] = useState<{ meetingCount?: number; recent?: { title: string | null; startedAt: string | null }[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api
      .getConnections()
      .then(setConnections)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load connections"));
  }, []);

  async function connectStripe() {
    setError(null);
    setBusy("stripe");
    try {
      setConnections(await api.connectStripe(stripeKey));
      setStripeKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect Stripe");
    } finally {
      setBusy(null);
    }
  }

  async function connectHubspot() {
    setError(null);
    setBusy("hubspot");
    try {
      setConnections(await api.connectHubspot(hubspotToken));
      setHubspotToken("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect HubSpot");
    } finally {
      setBusy(null);
    }
  }

  async function authorizeGmail() {
    setError(null);
    try {
      const { url } = await api.getGmailOAuthUrl();
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start Google authorization");
    }
  }

  async function authorizeCalendar() {
    setError(null);
    try {
      const { url } = await api.getCalendarOAuthUrl();
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start Google Calendar authorization");
    }
  }

  async function syncNow() {
    setError(null);
    setBusy("calendar");
    try {
      await api.syncCalendar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to sync calendar");
    } finally {
      setBusy(null);
    }
  }

  async function connectFireflies() {
    setError(null);
    setBusy("fireflies");
    try {
      setConnections(await api.connectFireflies(firefliesKey));
      setFirefliesKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect Fireflies");
    } finally {
      setBusy(null);
    }
  }

  async function testFireflies() {
    setError(null);
    setBusy("fireflies");
    try {
      const r = await api.testFireflies();
      if (!r.ok) {
        setError(r.message ?? "Fireflies connection is invalid");
        setFirefliesInfo(null);
      } else {
        setFirefliesInfo(r);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to test Fireflies");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(provider: "stripe" | "hubspot" | "gmail" | "google-calendar" | "fireflies") {
    setError(null);
    setBusy(provider);
    try {
      setConnections(await api.disconnectConnection(provider));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setBusy(null);
    }
  }

  const stripe = connections?.stripe.connected ?? false;
  const hubspot = connections?.hubspot.connected ?? false;
  const gmail = connections?.gmail.connected ?? false;
  const calendar = connections?.calendar.connected ?? false;
  const calendarNeedsReauth = connections?.calendar.needsReauth ?? false;
  const fireflies = connections?.fireflies.connected ?? false;

  return (
    <>
      <div className="main-header">
        <div>
          <div className="page-title">Integrations</div>
          <div className="page-subtitle">Connect your tools so Tubo can act on your behalf.</div>
        </div>
      </div>

      {evaluator && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          Google integration access is currently limited to approved test accounts during the assessment. The
          evaluator workspace is preconfigured with synthetic test data so the full workflow can be reviewed
          without connecting a personal Google account.
        </div>
      )}

      <Section title="Connections">
        <Card>
          <div className="field">
            <label>Stripe</label>
            <p className="helper">Paste a Stripe secret key to read subscription and trial state.</p>
            {stripe ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <StatusBadge connected />
                <Button variant="ghost" disabled={busy === "stripe"} onClick={() => void disconnect("stripe")}>
                  Disconnect
                </Button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <input
                  type="password"
                  value={stripeKey}
                  onChange={(e) => setStripeKey(e.target.value)}
                  placeholder="sk_test_…"
                  style={{ flex: 1 }}
                />
                <Button variant="primary" disabled={!stripeKey.trim() || busy === "stripe"} onClick={() => void connectStripe()}>
                  {busy === "stripe" ? "Connecting…" : "Connect"}
                </Button>
              </div>
            )}
          </div>
        </Card>
      </Section>

      <Section title="">
        <Card>
          <div className="field">
            <label>HubSpot</label>
            <p className="helper">Paste a HubSpot access token to read companies, contacts, deals, tasks, and notes.</p>
            {hubspot ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <StatusBadge connected />
                <Button variant="ghost" disabled={busy === "hubspot"} onClick={() => void disconnect("hubspot")}>
                  Disconnect
                </Button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <input
                  type="password"
                  value={hubspotToken}
                  onChange={(e) => setHubspotToken(e.target.value)}
                  placeholder="pat-…"
                  style={{ flex: 1 }}
                />
                <Button variant="primary" disabled={!hubspotToken.trim() || busy === "hubspot"} onClick={() => void connectHubspot()}>
                  {busy === "hubspot" ? "Connecting…" : "Connect"}
                </Button>
              </div>
            )}
          </div>
        </Card>
      </Section>

      <Section title="">
        <Card>
          <div className="field">
            <label>Gmail</label>
            <p className="helper">Authorize Google so we can read your email and prepare draft replies.</p>
            {gmail ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <StatusBadge connected />
                <Button variant="ghost" disabled={busy === "gmail"} onClick={() => void disconnect("gmail")}>
                  Disconnect
                </Button>
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                <Button variant="primary" onClick={() => void authorizeGmail()}>
                  Connect with Google
                </Button>
              </div>
            )}
          </div>
        </Card>
      </Section>

      <Section title="">
        <Card>
          <div className="field">
            <label>Google Calendar</label>
            <p className="helper">
              Calendar is used to understand meeting context and match notes from connected
              meeting tools. Tubo does not record meetings.
            </p>
            {calendar ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <StatusBadge connected />
                {calendarNeedsReauth ? (
                  <span className="badge badge-warning">Needs reauthorization</span>
                ) : null}
                <Button variant="secondary" disabled={busy === "calendar"} onClick={() => void syncNow()}>
                  {busy === "calendar" ? "Syncing…" : "Sync now"}
                </Button>
                <Button variant="ghost" disabled={busy === "calendar"} onClick={() => void disconnect("google-calendar")}>
                  Disconnect
                </Button>
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                <Button variant="primary" onClick={() => void authorizeCalendar()}>
                  Connect Calendar
                </Button>
              </div>
            )}
          </div>
        </Card>
      </Section>

      <Section title="">
        <Card>
          <div className="field">
            <label>Fireflies</label>
            <p className="helper">
              Tubo processes meetings recorded in your own Fireflies
              account. It never sends Fireflies into a meeting.
            </p>
            {fireflies ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                  <StatusBadge connected />
                  <Button variant="secondary" disabled={busy === "fireflies"} onClick={() => void testFireflies()}>
                    {busy === "fireflies" ? "Testing…" : "Test Connection"}
                  </Button>
                  <Button variant="ghost" disabled={busy === "fireflies"} onClick={() => void disconnect("fireflies")}>
                    Disconnect
                  </Button>
                </div>
                {firefliesInfo && (
                  <div className="helper" style={{ marginTop: 8 }}>
                    {firefliesInfo.meetingCount != null ? (
                      <p style={{ margin: 0 }}>Found {firefliesInfo.meetingCount} recent meeting(s).</p>
                    ) : null}
                    {firefliesInfo.recent?.length ? (
                      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                        {firefliesInfo.recent.map((m, i) => (
                          <li key={i}>
                            {m.title ?? "(untitled)"}
                            {m.startedAt ? ` · ${new Date(m.startedAt).toLocaleDateString()}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <input
                  type="password"
                  value={firefliesKey}
                  onChange={(e) => setFirefliesKey(e.target.value)}
                  placeholder="Fireflies API key"
                  style={{ flex: 1 }}
                />
                <Button variant="primary" disabled={!firefliesKey.trim() || busy === "fireflies"} onClick={() => void connectFireflies()}>
                  {busy === "fireflies" ? "Connecting…" : "Connect"}
                </Button>
              </div>
            )}
          </div>
        </Card>
      </Section>

      {error && (
        <div className="alert alert-error" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}
    </>
  );
}
