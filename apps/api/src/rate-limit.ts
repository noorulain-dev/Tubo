import type { Context, MiddlewareHandler } from "hono";

/**
 * Minimal in-memory sliding-window rate limiter for authentication endpoints
 * (login, register, verification resend, forgot password). Not a general
 * anti-abuse system — it only bounds high-frequency auth attempts per key.
 */

interface Window {
  timestamps: number[];
}

export interface RateLimitOptions {
  /** Maximum allowed hits within the window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Key the request by (defaults to IP, falling back to a constant). */
  keyFn?: (c: Context) => string;
}

const stores = new Map<string, Window>();

function clientKey(c: Context): string {
  // Prefer a cloud-provider forwarded-for header when present, else remote addr.
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return c.env?.incoming?.socket?.remoteAddress as string | undefined ?? "unknown";
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  return async (c: Context, next) => {
    const key = (opts.keyFn ? opts.keyFn(c) : clientKey(c)) || "unknown";
    const now = Date.now();
    const win = stores.get(key) ?? { timestamps: [] };
    win.timestamps = win.timestamps.filter((t) => now - t < opts.windowMs);
    if (win.timestamps.length >= opts.max) {
      return c.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "too many attempts; please try again shortly",
            requestId: (c as Context & { get: <T>(k: string) => T }).get("requestId") ?? undefined,
          },
        },
        429,
      );
    }
    win.timestamps.push(now);
    stores.set(key, win);
    return next();
  };
}

// Export for tests to reset state deterministically.
export function __resetRateLimitStores(): void {
  stores.clear();
}