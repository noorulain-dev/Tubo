import { ensureSchema } from "./db.js";
import { refreshTrackedAccount } from "./account-refresh.js";
import { createLiveApp } from "./live.js";
import { setPipelineService } from "./pipeline-service.js";
import { isLiveConfigured, loadConfig } from "./core.js";
import { initAssessmentEnv, resolveAssessmentUserId, validateOptIn } from "./assessment-provisioner.js";

/**
 * Assessment test utility — run the SAME real account.refresh pipeline for a
 * configured test account. Never injects fabricated events; it only reads source
 * state and emits events when the source genuinely changed.
 *
 *   npm run assessment:refresh-account -- --account <id>
 */
async function main(): Promise<void> {
  initAssessmentEnv();
  const { email } = validateOptIn();
  await ensureSchema();

  const config = loadConfig();
  if (isLiveConfigured(config)) {
    setPipelineService(createLiveApp(config).service);
  }

  const userId = await resolveAssessmentUserId(email);
  const arg = process.argv.indexOf("--account");
  const accountId = arg >= 0 ? process.argv[arg + 1] : undefined;
  if (!accountId) {
    process.stderr.write("Usage: npm run assessment:refresh-account -- --account <id>\n");
    process.exit(1);
  }

  const changes = await refreshTrackedAccount(userId, accountId);
  console.log(`Refreshed "${accountId}" — ${changes.length} material change(s)`);
  for (const c of changes) {
    console.log(`  ✓ ${c.eventType} ${JSON.stringify(c.payload)}`);
  }
}

void main().catch((err) => {
  process.stderr.write(`✗ ${(err as Error).message}\n`);
  process.exit(1);
});
