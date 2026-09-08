import pino from "pino";

/**
 * Production structured application logger (pino).
 *
 * Every log line is structured JSON. Sensitive fields — authorization headers,
 * OAuth/refresh/session tokens, passwords, API keys, secrets, verification /
 * reset tokens — are automatically redacted before output.
 */
const REDACT_PATHS = [
  "authorization",
  "cookie",
  "password",
  "secret",
  "apiKey",
  "api_key",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "sessionToken",
  "session_token",
  "verificationToken",
  "verification_token",
  "resetToken",
  "reset_token",
  "token",
  "*.authorization",
  "*.password",
  "*.secret",
  "*.apiKey",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  base: { service: "revexec-api" },
  // Deterministic timestamp the application can rely on in structured logs.
  timestamp: pino.stdTimeFunctions.isoTime,
});

/** A child logger bound to a request/job correlation id. */
export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}

export type { Logger } from "pino";