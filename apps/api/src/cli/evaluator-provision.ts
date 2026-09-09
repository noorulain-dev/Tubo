import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ensureSchema, getPool } from "../database/db.js";
import { hashPassword } from "../auth/password.js";
import { ASSESSMENT_PREFIX, seedScenarios } from "./assessment-provisioner.js";

/**
 * STEP 71B.14 — Provision a dedicated evaluator (demo) account.
 *
 * Creates (or resets) a single evaluator user with a password supplied ONLY via
 * server-side environment variables (never hard-coded in source, never exposed to
 * the frontend). The account is:
 *   - email-verified   (provider email is not deliverable during the assessment)
 *   - evaluator = true (read-only external execution: Execute is disabled)
 *   - pre-seeded with synthetic "[ASSESSMENT]"-tagged scenarios
 *
 * Credentials are provided in the submission instructions, not in public source.
 *
 *   npm run evaluator:provision
 *
 * Requires EVALUATOR_EMAIL and EVALUATOR_PASSWORD (min 8 chars) in the server env.
 */
function initEnv(): void {
  for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
    loadDotenv({ path: p });
  }
}

async function main(): Promise<void> {
  initEnv();
  const email = process.env.EVALUATOR_EMAIL?.trim().toLowerCase();
  const password = process.env.EVALUATOR_PASSWORD;
  if (!email) {
    throw new Error("EVALUATOR_EMAIL is required.");
  }
  if (!password || password.length < 8) {
    throw new Error("EVALUATOR_PASSWORD is required (minimum 8 characters).");
  }

  await ensureSchema();
  const pool = getPool();

  // Upsert the evaluator user: mark verified + evaluator so they can log in
  // without email delivery, and so external execution stays disabled.
  const id = randomUUID();
  const passwordHash = hashPassword(password);
  await pool.query(
    `INSERT INTO users (id, email, password_hash, email_verified_at, evaluator)
     VALUES ($1, $2, $3, now(), true)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           email_verified_at = now(),
           evaluator = true`,
    [id, email, passwordHash],
  );

  const res = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  const userId = (res.rows[0] as { id: string } | undefined)?.id;
  if (!userId) throw new Error("failed to resolve evaluator user id");

  const seeded = await seedScenarios(userId);

  console.log(`Evaluator workspace provisioned for ${email}`);
  console.log(`External execution: DISABLED (evaluator tenant)`);
  console.log("Seeded synthetic accounts (idempotent):");
  for (const r of seeded) {
    console.log(`  ✓ ${r.scenario} -> ${r.accountId} (${r.events} event(s))`);
  }
  console.log(`\nAll seeded records are synthetic and tagged "${ASSESSMENT_PREFIX}".`);
  console.log("Share the login credentials ONLY in the private submission instructions.");
}

void main().catch((err) => {
  process.stderr.write(`✗ ${(err as Error).message}\n`);
  process.exit(1);
});