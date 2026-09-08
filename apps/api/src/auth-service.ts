import { randomBytes } from "node:crypto";
import { getPool } from "./db.js";
import { hashPassword, verifyPassword } from "./password.js";

export interface AuthUser {
  id: string;
  email: string;
}

const SESSION_TTL = "30 days";

export async function registerUser(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const id = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password);
  const token = randomBytes(32).toString("hex");
  const pool = getPool();
  await pool.query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)", [id, email, passwordHash]);
  await pool.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + $3::interval)", [token, id, SESSION_TTL]);
  return { token, user: { id, email } };
}

export async function loginUser(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const pool = getPool();
  const res = await pool.query("SELECT id, email, password_hash FROM users WHERE email = $1", [email]);
  const row = res.rows[0] as { id: string; email: string; password_hash: string } | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new Error("Invalid email or password");
  }
  const token = randomBytes(32).toString("hex");
  await pool.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + $3::interval)", [token, row.id, SESSION_TTL]);
  return { token, user: { id: row.id, email: row.email } };
}

export async function getUserByToken(token: string): Promise<AuthUser | null> {
  const pool = getPool();
  const res = await pool.query(
    "SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now()",
    [token],
  );
  const row = res.rows[0] as { id: string; email: string } | undefined;
  return row ? { id: row.id, email: row.email } : null;
}

export async function logout(token: string): Promise<void> {
  const pool = getPool();
  await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
}
