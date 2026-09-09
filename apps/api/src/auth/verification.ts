import { AppError } from "../shared/core.js";
import { getPool, withTransaction } from "../database/db.js";
import { appBaseUrl, getEmailProvider } from "./email.js";
import { hashPassword } from "./password.js";
import { logger } from "../observability/logger.js";
import { hashToken, newToken } from "./email-verification.service.js";

const RESET_TTL = "1 hour";

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