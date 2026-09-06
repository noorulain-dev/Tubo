import type { Context, MiddlewareHandler } from "hono";

/**
 * Minimal bearer-token auth for the assessment/demo. If no token is configured,
 * authentication is disabled (Sample Mode / local demo). In integration mode the
 * operator sets AUTH_TOKEN and the frontend must present it on mutating routes.
 * The frontend never receives backend credentials; it only holds this token (or
 * a server-side proxy forwards it).
 */
export function bearerAuth(token: string | undefined): MiddlewareHandler {
  return async (c: Context, next) => {
    if (!token) return next();
    const header = c.req.header("authorization") ?? "";
    if (header !== `Bearer ${token}`) {
      return c.json({ error: { code: "AUTHENTICATION", message: "Unauthorized" } }, 401);
    }
    return next();
  };
}
