import { cleanupAssessment, initAssessmentEnv, resolveAssessmentUserId, validateOptIn } from "./assessment-provisioner.js";

async function main(): Promise<void> {
  initAssessmentEnv();
  const { email } = validateOptIn();
  const userId = await resolveAssessmentUserId(email);
  const results = await cleanupAssessment(userId);

  console.log(`Assessment cleanup for user ${email}:`);
  for (const r of results) {
    console.log(`  ${r.table}: removed ${r.deleted} tagged row(s)`);
  }
  console.log("\nOnly [ASSESSMENT]-tagged rows for the exact test user were removed. Real records were never touched.");
}

void main().catch((err) => {
  process.stderr.write(`✗ ${(err as Error).message}\n`);
  process.exit(1);
});
