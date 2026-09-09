import { randomBytes } from "node:crypto";
import { AppError } from "../shared/core.js";
import { hashPassword, verifyPassword } from "./password.js";
import { createSession, createUser, deleteSessionByToken, findUserByEmail, findUserBySessionToken } from "./auth-repository.js";

export interface AuthUser {
  id: string;
  email: string;
  /** True for a dedicated evaluator/demo account (external execution disabled). */
  evaluator: boolean;
}

const SESSION_TTL = "30 days";

export async function registerUser(email: string, password: string): Promise<{ user: AuthUser }> {
  const id = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password);
  // New registrations start unverified (email_verified_at is NULL).
  await createUser(id, email, passwordHash);
  return { user: { id, email, evaluator: false } };
}

export async function loginUser(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const row = await findUserByEmail(email);
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new AppError({ code: "AUTHENTICATION", message: "invalid email or password", status: 401 });
  }
  if (!row.email_verified_at) {
    throw new AppError({ code: "EMAIL_NOT_VERIFIED", message: "please verify your email before signing in", status: 403 });
  }
  const token = randomBytes(32).toString("hex");
  await createSession(token, row.id, SESSION_TTL);
  return { token, user: { id: row.id, email: row.email, evaluator: !!row.evaluator } };
}

export async function getUserByToken(token: string): Promise<AuthUser | null> {
  return findUserBySessionToken(token);
}

export async function logout(token: string): Promise<void> {
  await deleteSessionByToken(token);
}
