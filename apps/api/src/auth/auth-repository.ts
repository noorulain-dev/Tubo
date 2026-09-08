import { getPool } from "../database/db.js";
import type { AuthUser } from "./auth-service.js";

export async function createUser(id: string, email: string, passwordHash: string): Promise<void> {
  await getPool().query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)", [id, email, passwordHash]);
}

export async function findUserByEmail(email: string): Promise<{ id: string; email: string; password_hash: string; email_verified_at: string | null } | null> {
  const res = await getPool().query("SELECT id, email, password_hash, email_verified_at FROM users WHERE email = $1", [email]);
  const row = res.rows[0] as { id: string; email: string; password_hash: string; email_verified_at: string | null } | undefined;
  return row ?? null;
}

export async function createSession(token: string, userId: string, ttl: string): Promise<void> {
  await getPool().query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + $3::interval)", [token, userId, ttl]);
}

export async function findUserBySessionToken(token: string): Promise<AuthUser | null> {
  const res = await getPool().query(
    "SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now()",
    [token],
  );
  const row = res.rows[0] as { id: string; email: string } | undefined;
  return row ? { id: row.id, email: row.email } : null;
}

export async function deleteSessionByToken(token: string): Promise<void> {
  await getPool().query("DELETE FROM sessions WHERE token = $1", [token]);
}