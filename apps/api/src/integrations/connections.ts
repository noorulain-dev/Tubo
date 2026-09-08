import { getPool } from "../database/db.js";
import { decryptSecret, encryptSecret } from "../auth/encryption.js";

export type ConnectionProvider = "stripe" | "hubspot" | "gmail" | "google-calendar" | "fireflies";
export type ConnectionState = "connected" | "needs_reauth";

export interface ConnectionStatus {
  stripe: { connected: boolean; needsReauth: boolean };
  hubspot: { connected: boolean; needsReauth: boolean };
  gmail: { connected: boolean; needsReauth: boolean };
  calendar: { connected: boolean; needsReauth: boolean };
  fireflies: { connected: boolean; needsReauth: boolean };
}

const PROVIDERS: ConnectionProvider[] = ["stripe", "hubspot", "gmail", "google-calendar", "fireflies"];

async function getSecret(userId: string, provider: ConnectionProvider): Promise<string | null> {
  const pool = getPool();
  const res = await pool.query("SELECT secret FROM connections WHERE user_id = $1 AND provider = $2", [userId, provider]);
  const row = res.rows[0] as { secret: string } | undefined;
  return row ? decryptSecret(row.secret) : null;
}

export async function setConnection(userId: string, provider: ConnectionProvider, secret: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO connections (user_id, provider, secret, status)
     VALUES ($1, $2, $3, 'connected')
     ON CONFLICT (user_id, provider) DO UPDATE SET secret = EXCLUDED.secret, status = 'connected'`,
    [userId, provider, encryptSecret(secret)],
  );
}

export async function markNeedsReauth(userId: string, provider: ConnectionProvider): Promise<void> {
  const pool = getPool();
  await pool.query("UPDATE connections SET status = 'needs_reauth' WHERE user_id = $1 AND provider = $2", [userId, provider]);
}

export async function removeConnection(userId: string, provider: ConnectionProvider): Promise<void> {
  const pool = getPool();
  await pool.query("DELETE FROM connections WHERE user_id = $1 AND provider = $2", [userId, provider]);
}

export async function getConnectionsStatus(userId: string): Promise<ConnectionStatus> {
  const pool = getPool();
  const res = await pool.query("SELECT provider, status FROM connections WHERE user_id = $1", [userId]);
  const states = new Map<string, ConnectionState>();
  for (const row of res.rows as { provider: string; status: ConnectionState }[]) {
    states.set(row.provider, row.status);
  }
  const view = (p: ConnectionProvider) => ({
    connected: states.has(p),
    needsReauth: states.get(p) === "needs_reauth",
  });
  return {
    stripe: view("stripe"),
    hubspot: view("hubspot"),
    gmail: view("gmail"),
    calendar: view("google-calendar"),
    fireflies: view("fireflies"),
  };
}

/** Retrieve a decrypted secret server-side for wiring the live pipeline. */
export async function getStripeSecretKey(userId: string): Promise<string | null> {
  return getSecret(userId, "stripe");
}

export async function getHubspotAccessToken(userId: string): Promise<string | null> {
  return getSecret(userId, "hubspot");
}

export async function getGmailRefreshToken(userId: string): Promise<string | null> {
  return getSecret(userId, "gmail");
}

export async function getCalendarRefreshToken(userId: string): Promise<string | null> {
  return getSecret(userId, "google-calendar");
}

export async function getFirefliesApiKey(userId: string): Promise<string | null> {
  return getSecret(userId, "fireflies");
}
