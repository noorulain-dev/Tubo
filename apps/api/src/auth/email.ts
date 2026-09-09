import { AppError, loadConfig } from "../shared/core.js";
import { logger } from "../observability/logger.js";

/**
 * Tiny transactional-email abstraction for authentication mail (verification +
 * password reset). This is separate from, and never uses, the user's connected
 * Gmail revenue integration.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface TransactionalEmailProvider {
  send(message: EmailMessage): Promise<{ id: string }>;
}

/** Logs the message (dev/test fallback). Never claims a real send in production. */
export class LoggingEmailProvider implements TransactionalEmailProvider {
  async send(message: EmailMessage): Promise<{ id: string }> {
    const id = `log_${Date.now()}`;
    logger.warn({ event: "email_logged_not_sent", id, to: message.to, subject: message.subject }, "no email provider configured; message logged only");
    return { id };
  }
}

/** Minimal Resend REST client (no SDK dependency). Configure RESEND_API_KEY. */
export class ResendEmailProvider implements TransactionalEmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<{ id: string }> {
    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {}) }),
      });
    } catch (e) {
      throw new AppError({ code: "PROVIDER_ERROR", message: "email delivery failed", cause: e, retryable: true });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AppError({ code: "PROVIDER_ERROR", message: `email delivery failed (HTTP ${res.status})`, details: body.slice(0, 200) });
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    if (!json.id) throw new AppError({ code: "PROVIDER_ERROR", message: "email delivery returned no message id" });
    return { id: json.id };
  }
}

/** Choose the configured provider; in production a missing provider is an error. */
export function getEmailProvider(): TransactionalEmailProvider {
  const cfg = loadConfig();
  if (cfg.resendApiKey) {
    return new ResendEmailProvider(cfg.resendApiKey, cfg.emailFrom ?? "Revenue Execution OS <onboarding@resend.dev>");
  }
  if (cfg.nodeEnv === "production") {
    // Production must not silently pretend an email was sent.
    throw new AppError({ code: "PROVIDER_ERROR", message: "no transactional email provider configured (set RESEND_API_KEY)" });
  }
  return new LoggingEmailProvider();
}

export function appBaseUrl(): string {
  return (loadConfig().appBaseUrl ?? "http://localhost:5173").replace(/\/$/, "");
}