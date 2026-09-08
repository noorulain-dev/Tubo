import { FirefliesProvider } from "./core.js";
import { fail, initSmokeEnv, ok, resolveSmokeCredentials } from "./smoke-shared.js";

initSmokeEnv();

async function main(): Promise<void> {
  const creds = await resolveSmokeCredentials();
  if (!creds.firefliesApiKey) {
    process.stderr.write("✗ no Fireflies connection for this user (connect Fireflies first).\n");
    process.exit(1);
  }

  let failed = false;
  try {
    const provider = new FirefliesProvider({ apiKey: creds.firefliesApiKey });
    const check = await provider.validateConnection();
    if (!check.ok) {
      fail("authenticated", check.message ?? "connection invalid");
      process.exit(1);
    }
    ok("authenticated");
    const meetings = await provider.listRecentMeetings();
    ok(`meetings listed (${meetings.length})`);
    for (const m of meetings.slice(0, 5)) {
      process.stdout.write(`  • ${m.title ?? "(untitled)"} @ ${m.startedAt ?? "?"}\n`);
    }
    ok("read-only (no bot/attendance commands)");
  } catch (e) {
    failed = true;
    fail("fireflies", e instanceof Error ? e.message : String(e));
  }

  if (failed) {
    process.stderr.write("Fireflies smoke test FAILED.\n");
    process.exit(1);
  }
  process.stdout.write("Fireflies smoke test passed.\n");
}

void main();