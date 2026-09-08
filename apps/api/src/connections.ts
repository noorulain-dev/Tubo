import { getPool } from "./db.js";

export type ConnectionProvider = "stripe" | "hubspot" | "gmail";

export interface ConnectionStatus {
  stripe: { connected: boolean };
  hubspot: { connected: boolean };
  gmail: { connected: boolean };
}

const PROVIDERS: ConnectionProvider[] = ["stripe", "hubspot", "gmail"];

async function getSecret(userId: string, provider: ConnectionProvider): Promise<string | null> {
  const pool = getPool();
  const res = await pool.query("SELECT secret FROM connections WHERE user_id = $1 AND provider = $2", [userId, provider]);
  const row = res.rows[0] as { secret: string } | undefined;
  return row?.secret ?? null;
}

export async function setConnection(userId: string, provider: ConnectionProvider, secret: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    "INSERT INTO connections (user_id, provider, secret) VALUES ($1, $2, $3) ON CONFLICT (user_id, provider) DO UPDATE SET secret = EXCLUDED.secret",
    [userId, provider, secret],
  );
}

export async function removeConnection(userId: string, provider: ConnectionProvider): Promise<void> {
  const pool = getPool();
  await pool.query("DELETE FROM connections WHERE user_id = $1 AND provider = $2", [userId, provider]);
}

export async function getConnectionsStatus(userId: string): Promise<ConnectionStatus> {
  const results = await Promise.all(PROVIDERS.map((p) => getSecret(userId, p)));
  return {
    stripe: { connected: Boolean(results[0]) },
    hubspot: { connected: Boolean(results[1]) },
    gmail: { connected: Boolean(results[2]) },
  };
}

/** Retrieve a stored secret server-side for wiring the live pipeline. */
export async function getStripeSecretKey(userId: string): Promise<string | null> {
  return getSecret(userId, "stripe");
}

export async function getHubspotAccessToken(userId: string): Promise<string | null> {
  return getSecret(userId, "hubspot");
}

export async function getGmailRefreshToken(userId: string): Promise<string | null> {
  return getSecret(userId, "gmail");
}
