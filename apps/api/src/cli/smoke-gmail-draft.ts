import { AuditService, GmailClient, GmailProvider, MemoryAuditSink, type CreateDraftInput } from "../shared/core.js";
import { exchangeGmailRefreshToken } from "../integrations/gmail-oauth.js";
import { fail, gmailClientConfig, initSmokeEnv, ok, resolveSmokeCredentials } from "./smoke-shared.js";

initSmokeEnv();

const SUBJECT = "[Revenue Execution OS Test] Draft Verification";

async function main(): Promise<void> {
  if (process.env.ALLOW_LIVE_TEST_WRITES !== "true") {
    process.stderr.write("✗ set ALLOW_LIVE_TEST_WRITES=true to create a live Gmail TEST draft (opt-in).\n");
    process.exit(2);
  }

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
  const to = process.env.SMOKE_GMAIL_TO;
  if (!to) {
    process.stderr.write("✗ SMOKE_GMAIL_TO is required (recipient for the TEST draft).\n");
    process.exit(1);
  }

  let failed = false;
  try {
    const { accessToken } = await exchangeGmailRefreshToken({ clientId, clientSecret, refreshToken: creds.gmailRefreshToken });
    const audit = new AuditService(new MemoryAuditSink());
    const client = new GmailClient({ accessToken, audit });
    const provider = new GmailProvider(client, { audit });

    // Idempotency: if a draft with this fixed subject already exists, reuse it
    // instead of creating an endless stream of duplicates.
    const existing = (await client.get(`/gmail/v1/users/me/drafts?q=${encodeURIComponent(`subject:${SUBJECT}`)}`)) as {
      drafts?: { id: string }[];
    };
    if (existing.drafts?.length) {
      ok(`draft already exists (id ${existing.drafts[0].id}) — skipping`);
    } else {
      const input: CreateDraftInput = {
        to: [to],
        subject: SUBJECT,
        body: "This is an automated TEST draft created by the Revenue Execution OS smoke test. It will never be sent.",
      };
      const { externalRef } = await provider.createDraft(input);
      ok(`draft created (id ${externalRef})`);
    }
    ok("send NOT attempted (draft-only)");
  } catch (e) {
    failed = true;
    fail("gmail draft", e instanceof Error ? e.message : String(e));
  }

  if (failed) {
    process.stderr.write("Gmail draft smoke test FAILED.\n");
    process.exit(1);
  }
  process.stdout.write("Gmail draft smoke test passed (draft only, never sent).\n");
}

void main();