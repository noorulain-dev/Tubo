import { createHash, randomBytes } from "node:crypto";
import { AppError } from "../shared/core.js";
import { getPool, withTransaction } from "../database/db.js";
import { appBaseUrl, getEmailProvider } from "./email.js";
import { logger } from "../observability/logger.js";

/**
 * Email verification for NEW registrations.
 *
 * - 32-byte high-entropy token; only its SHA-256 hash is stored (never the raw
 *   token — so it can't leak via DB or logs).
 * - 24h expiry, single-use (atomically consumed), resend cooldown.
 * - Existing users remain verified (backfilled at migration time).
 * - Token value is never logged.
 */

const VERIFY_TTL = "24 hours";
const RESEND_COOLDOWN_MS = 60_000;

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

/** Create a verification token row; returns the raw token (sent via email link). */
export async function createVerificationToken(userId: string): Promise<string> {
  const raw = newToken();
  await getPool().query(
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

  await sendVerificationEmail(email, row.id);
}

export async function sendVerificationEmail(email: string, userId: string): Promise<void> {
  const raw = await createVerificationToken(userId);
  const link = `${appBaseUrl()}/verify-email?token=${raw}`;
  await getEmailProvider().send({
    to: email,
    subject: "Verify your email",
    text: `Verify your email: ${link}`,
    html: `<p>Verify your email: <a href="${link}">${link}</a></p>`,
  });
  logger.info({ event: "verification_email_sent", email }, "verification email sent");
}