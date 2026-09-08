import { GoogleCalendarProvider } from "../shared/core.js";
import { exchangeGmailRefreshToken } from "../integrations/gmail-oauth.js";
import { fail, gmailClientConfig, initSmokeEnv, ok, resolveSmokeCredentials } from "./smoke-shared.js";

initSmokeEnv();

async function main(): Promise<void> {
  const creds = await resolveSmokeCredentials();
  const refreshToken = creds.calendarRefreshToken ?? creds.gmailRefreshToken;
  if (!refreshToken) {
    process.stderr.write("✗ no Google Calendar connection for this user (connect Calendar first).\n");
    process.exit(1);
  }
  const { clientId, clientSecret } = gmailClientConfig();
  if (!clientId || !clientSecret) {
    process.stderr.write("✗ GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are required.\n");
    process.exit(1);
  }

  let failed = false;
  try {
    const { accessToken } = await exchangeGmailRefreshToken({ clientId, clientSecret, refreshToken });
    ok("authenticated");
    const provider = new GoogleCalendarProvider({ accessToken });
    const end = new Date(Date.now() + 48 * 3600 * 1000);
    const start = new Date(Date.now() - 48 * 3600 * 1000);
    const events = await provider.listEvents({ start, end });
    ok(`events listed (${events.length})`);
    for (const e of events.slice(0, 5)) {
      process.stdout.write(`  • ${e.title ?? "(untitled)"} @ ${e.startAt ?? "?"}\n`);
    }
    ok("calendar read-only (no writes requested)");
  } catch (e) {
    failed = true;
    fail("calendar", e instanceof Error ? e.message : String(e));
  }

  if (failed) {
    process.stderr.write("Calendar smoke test FAILED.\n");
    process.exit(1);
  }
  process.stdout.write("Calendar smoke test passed.\n");
}

void main();