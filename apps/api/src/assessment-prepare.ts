import { ASSESSMENT_PREFIX, initAssessmentEnv, resolveAssessmentUserId, seedScenarios, validateOptIn } from "./assessment-provisioner.js";

async function main(): Promise<void> {
  initAssessmentEnv();
  const { email, hubspotPortalId } = validateOptIn();
  const userId = await resolveAssessmentUserId(email);

  console.log(`Assessment provisioning (opt-in confirmed) for user ${email}`);
  console.log(`HubSpot portal: ${hubspotPortalId ?? "(not set — internal DB only)"}\n`);

  const results = await seedScenarios(userId);
  console.log("Seeded synthetic accounts (idempotent):");
  for (const r of results) {
    console.log(`  ✓ ${r.scenario} -> ${r.accountId} (${r.events} event(s))`);
  }

  console.log("\n──────────────────────────────────────────────");
  console.log("MANUAL PROVIDER SETUP (never faked as real data)");
  console.log("──────────────────────────────────────────────");
  console.log(`HubSpot: create synthetic Company/Deal records named with the "${ASSESSMENT_PREFIX}" prefix`);
  console.log("  and set the 'revexec_billing_status' property (see assessment:hubspot:setup).");
  console.log("  Do NOT point at production customer records.");
  console.log(`Gmail: manually compose one draft/thread per scenario, using "${ASSESSMENT_PREFIX}" in the subject.`);
  console.log(`Fireflies: record synthetic meetings yourself; they will be ingested as "${ASSESSMENT_PREFIX}"-tagged artifacts.`);
  console.log("Provider-failure and prompt-injection scenarios are automated test fixtures only.");
}

void main().catch((err) => {
  process.stderr.write(`✗ ${(err as Error).message}\n`);
  process.exit(1);
});
