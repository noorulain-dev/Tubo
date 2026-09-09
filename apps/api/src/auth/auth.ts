import type { Context, MiddlewareHandler } from "hono";
import { getUserByToken, type AuthUser } from "./auth-service.js";
import { isDbConfigured } from "../database/db.js";

/** Paths reachable without a session (OAuth callbacks, auth, health, public read-only surfaces). */
const PUBLIC_PATHS = new Set([
  "/health",
  "/auth/register",
  "/auth/login",
  "/auth/verify-email",
  "/auth/resend-verification",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/gmail/oauth/callback",
  "/integrations/google-calendar/oauth/callback",
  "/integrations/google-calendar/notifications",
  "/evaluation/summary",
]);

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

/**
 * Session-token auth. When DATABASE_URL is absent (tests / no persistence
 * configured), auth is disabled and every route is open — mirroring the old
 * "no token configured" behavior. Otherwise the Authorization bearer token is
 * validated against the sessions table and the authenticated user is attached
 * to the context.
 */
export function bearerAuth(): MiddlewareHandler {
  return async (c: Context, next) => {
    if (!isDbConfigured()) return next();
    if (PUBLIC_PATHS.has(c.req.path)) return next();

    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!token) {
      return c.json({ error: { code: "AUTHENTICATION", message: "Unauthorized" } }, 401);
    }

    const user = await getUserByToken(token).catch(() => null);
    if (!user) {
      return c.json({ error: { code: "AUTHENTICATION", message: "Unauthorized" } }, 401);
    }
    c.set("user", user);
    return next();
  };
}
