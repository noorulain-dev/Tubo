import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { ensureSchema, isDbConfigured } from "../database/db.js";
import { isLiveConfigured, loadConfig } from "../shared/core.js";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  loadDotenv({ path: p });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const checks: [string, boolean][] = [
    ["DATABASE_URL configured", isDbConfigured()],
    ["LLM configured", isLiveConfigured(config)],
    ["HubSpot token", Boolean(process.env.HUBSPOT_ACCESS_TOKEN)],
    ["Gmail OAuth client", Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET)],
    ["Calendar webhook URL", Boolean(process.env.CALENDAR_WEBHOOK_URL)],
  ];

  if (isDbConfigured()) {
    await ensureSchema();
  }

  let failed = false;
  for (const [label, ok] of checks) {
    process.stdout.write(`${ok ? "✓" : "✗"} ${label}\n`);
    if (!ok) failed = true;
  }
  process.stdout.write("Run `npm run worker` in a second terminal for background jobs.\n");
  process.exit(failed ? 1 : 0);
}

void main();
