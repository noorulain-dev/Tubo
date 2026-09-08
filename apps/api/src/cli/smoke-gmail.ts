import { AuditService, GmailClient, GmailProvider, MemoryAuditSink } from "../shared/core.js";
import { exchangeGmailRefreshToken } from "../integrations/gmail-oauth.js";
import { fail, gmailClientConfig, initSmokeEnv, ok, resolveSmokeCredentials } from "./smoke-shared.js";

initSmokeEnv();

async function main(): Promise<void> {
  const creds = await resolveSmokeCredentials();
  if (!creds.gmailRefreshToken) {
    process.stderr.write("✗ no Gmail connection for this user (authorize first, or set GMAIL_REFRESH_TOKEN).\n");
    process.exit(1);
  }
  const { clientId, clientSecret } = gmailClientConfig();
  if (!clientId || !clientSecret) {
    process.stderr.write("✗ GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are required.\n");
    process.exit(1);
  }

  let failed = false;
  try {
    const { accessToken } = await exchangeGmailRefreshToken({ clientId, clientSecret, refreshToken: creds.gmailRefreshToken });
    ok("authenticated");
    const audit = new AuditService(new MemoryAuditSink());
    const client = new GmailClient({ accessToken, audit });
    const provider = new GmailProvider(client, { audit });

    // List threads
    const list = (await client.get("/gmail/v1/users/me/threads", { maxResults: 5 })) as { threads?: { id: string }[] };
    const threadId = list.threads?.[0]?.id;
    ok(`threads listed (${list.threads?.length ?? 0})`);

    if (threadId) {
      const thread = await provider.getThread(threadId);
      ok(`thread read (${thread ? "ok" : "empty"})`);
      const hasOutbound = await provider.hasOutboundCommunication(threadId);
      ok(`outbound communication check (${hasOutbound ? "sent" : "none"})`);
    } else {
      ok("thread read (no threads available)");
    }
  } catch (e) {
    failed = true;
    fail("gmail read", e instanceof Error ? e.message : String(e));
  }

  if (failed) {
    process.stderr.write("Gmail smoke test FAILED.\n");
    process.exit(1);
  }
  process.stdout.write("Gmail smoke test passed.\n");
}

void main();
