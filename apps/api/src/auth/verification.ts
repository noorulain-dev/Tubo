import { createHash, randomBytes } from "node:crypto";
import { AppError } from "../shared/core.js";
import { getPool, withTransaction } from "../database/db.js";
import { appBaseUrl, getEmailProvider } from "./email.js";
import { hashPassword } from "./password.js";
import { logger } from "../observability/logger.js";

/**
 * Email verification + password reset. Tokens are high-entropy random values;
 * only their SHA-256 hash is stored. Single-use, with a short expiry and a
 * resend cooldown. Existence of an email address is never revealed.
 */

const VERIFY_TTL = "24 hours";
const RESET_TTL = "1 hour";
const RESEND_COOLDOWN_MS = 60_000;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("hex");
}

export async function createVerificationToken(userId: string): Promise<string> {
  const raw = newToken();
  const pool = getPool();
  await pool.query(
    "INSERT INTO verification_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3::interval)",
    [hashToken(raw), userId, VERIFY_TTL],
  );
  return raw;
}

export async function consumeVerificationToken(raw: string): Promise<string> {
  // Atomic: consume the token and mark verified in one transaction.
  return withTransaction(async (tx) => {
    const res = await tx.query(
      "DELETE FROM verification_tokens WHERE token_hash = $1 AND expires_at > now() RETURNING user_id",
      [hashToken(raw)],
    );
    const userId = res.rows[0]?.user_id as string | undefined;
    if (!userId) throw new AppError({ code: "VALIDATION", message: "invalid or expired verification link", status: 400 });
    await tx.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [userId]);
    return userId;
  });
}

export async function resendVerification(email: string): Promise<void> {
  const pool = getPool();
  const res = await pool.query("SELECT id, email_verified_at FROM users WHERE email = $1", [email]);
  const row = res.rows[0] as { id: string; email_verified_at: string | null } | undefined;
  if (!row || row.email_verified_at) return; // generic no-op; never reveal existence

  const last = await pool.query("SELECT max(created_at) AS at FROM verification_tokens WHERE user_id = $1", [row.id]);
  const lastAt = last.rows[0]?.at as string | undefined;
  if (lastAt && Date.now() - new Date(lastAt).getTime() < RESEND_COOLDOWN_MS) {
    throw new AppError({ code: "RATE_LIMIT", message: "please wait before requesting another email", status: 429 });
  }

  const raw = await createVerificationToken(row.id);
  const link = `${appBaseUrl()}/verify-email?token=${raw}`;
  await getEmailProvider().send({ to: email, subject: "Verify your email", text: `Verify your email: ${link}`, html: `<p>Verify your email: <a href="${link}">${link}</a></p>` });
  logger.info({ event: "verification_email_sent", email }, "verification email sent");
}

export async function sendVerificationEmail(email: string, userId: string): Promise<void> {
  const raw = await createVerificationToken(userId);
  const link = `${appBaseUrl()}/verify-email?token=${raw}`;
  await getEmailProvider().send({ to: email, subject: "Verify your email", text: `Verify your email: ${link}`, html: `<p>Verify your email: <a href="${link}">${link}</a></p>` });
  logger.info({ event: "verification_email_sent", email }, "verification email sent");
}

export async function createPasswordReset(email: string): Promise<void> {
  const pool = getPool();
  const res = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  const row = res.rows[0] as { id: string } | undefined;
  // Always return success (do not reveal account existence). Emit a log only for
  // a real account for observability without exposing anything to the caller.
  if (!row) return;

  const raw = newToken();
  await pool.query("INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3::interval)", [hashToken(raw), row.id, RESET_TTL]);
  const link = `${appBaseUrl()}/reset-password?token=${raw}`;
  await getEmailProvider().send({ to: email, subject: "Reset your password", text: `Reset your password: ${link}`, html: `<p>Reset your password: <a href="${link}">${link}</a></p>` });
  logger.info({ event: "password_reset_email_sent", email }, "password reset email sent");
}

export async function consumePasswordReset(raw: string, newPassword: string): Promise<string> {
  const passwordHash = hashPassword(newPassword);
  // Atomic: consume token, rotate password, and invalidate sessions together.
  return withTransaction(async (tx) => {
    const res = await tx.query(
      "DELETE FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > now() AND used_at IS NULL RETURNING user_id",
      [hashToken(raw)],
    );
    const userId = res.rows[0]?.user_id as string | undefined;
    if (!userId) throw new AppError({ code: "VALIDATION", message: "invalid or expired reset link", status: 400 });
    await tx.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, userId]);
    // Invalidate all existing sessions for this user after a reset.
    await tx.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
    return userId;
  });
}