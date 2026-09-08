import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  loadDotenv({ path: p });
}

// Opt-in write verification. Delegate to the individual gated smoke commands,
// which operate ONLY on explicitly configured assessment test records and
// never send Gmail.
async function main(): Promise<void> {
  if (process.env.ALLOW_LIVE_TEST_WRITES !== "true") {
    process.stderr.write("✗ set ALLOW_LIVE_TEST_WRITES=true to run live test writes (opt-in).\n");
    process.exit(2);
  }

  process.stdout.write("Run the individual gated write checks:\n");
  process.stdout.write("  npm run smoke:hubspot-write   (creates a [smoke …] task + note on HUBSPOT_SMOKE_COMPANY_ID)\n");
  process.stdout.write("  npm run smoke:gmail-draft     (creates a [TEST] draft; never sends — needs SMOKE_GMAIL_TO)\n");
}

void main();
