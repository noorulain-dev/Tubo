import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { ensureSchema, getPool } from "./db.js";

export interface SmokeCredentials {
  userId: string;
  hubspotToken?: string;
  gmailRefreshToken?: string;
  calendarRefreshToken?: string;
  firefliesApiKey?: string;
}

export function initSmokeEnv(): void {
  for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
    loadDotenv({ path: p });
  }
}

/**
 * Resolve the authenticated test user's real connections from the database
 * (identified by SMOKE_USER_EMAIL), falling back to operator .env credentials
 * where a DB connection is absent. Never fabricates a credential.
 */
export async function resolveSmokeCredentials(): Promise<SmokeCredentials> {
  const email = process.env.SMOKE_USER_EMAIL?.toLowerCase();
  if (!email) {
    // No DB user specified — fall back to operator env credentials.
    return {
      userId: "operator",
      hubspotToken: process.env.HUBSPOT_ACCESS_TOKEN,
      gmailRefreshToken: process.env.GMAIL_REFRESH_TOKEN,
    };
  }

  await ensureSchema();
  const pool = getPool();
  const ures = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  const userId = ures.rows[0]?.id as string | undefined;
  if (!userId) throw new Error(`no user found for SMOKE_USER_EMAIL=${email}`);

  const cres = await pool.query("SELECT provider, secret FROM connections WHERE user_id = $1", [userId]);
  const creds: SmokeCredentials = { userId };
  for (const row of cres.rows as { provider: string; secret: string }[]) {
    if (row.provider === "hubspot") creds.hubspotToken = row.secret;
    if (row.provider === "gmail") creds.gmailRefreshToken = row.secret;
    if (row.provider === "google-calendar") creds.calendarRefreshToken = row.secret;
    if (row.provider === "fireflies") creds.firefliesApiKey = row.secret;
  }
  return creds;
}

export function gmailClientConfig(): { clientId?: string; clientSecret?: string } {
  return { clientId: process.env.GMAIL_CLIENT_ID, clientSecret: process.env.GMAIL_CLIENT_SECRET };
}

export function ok(label: string): void {
  process.stdout.write(`✓ ${label}\n`);
}

export function fail(label: string, message: string): void {
  process.stderr.write(`✗ ${label}: ${redact(message)}\n`);
}

function redact(value: string): string {
  return value
    .replace(/(sk_(?:live|test)_[A-Za-z0-9]+)/g, "***")
    .replace(/(pat-[A-Za-z0-9-]+)/g, "***")
    .replace(/(1\/\/[A-Za-z0-9_-]+)/g, "***");
}
