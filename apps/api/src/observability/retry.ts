import { TimeoutError } from "../shared/core.js";

/**
 * Reusable bounded retry + timeout primitives for external provider calls.
 * Retry only transient failures (network, 408, 429, 5xx); never retry 400/401/
 * 403/404, validation errors, or policy rejections. Bounded exponential backoff
 * with full jitter and a hard attempt cap — it can never loop indefinitely.
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  /** Classify a thrown error / failed result as retryable. */
  isRetryable?: (err: unknown) => boolean;
}

export function isTransientHttpError(err: unknown): boolean {
  const code = (err as { code?: string | number } | undefined)?.code;
  const status = typeof code === "number" ? code : Number(code);
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export function isNetworkError(err: unknown): boolean {
  if (err instanceof Error) {
    const e = err as NodeJS.ErrnoException;
    return e.code === "ECONNRESET" || e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT" || e.code === "EAI_AGAIN" || e.name === "AbortError" || e.name === "TypeError";
  }
  return false;
}

/** Default: retry network errors + transient HTTP statuses only. */
export function defaultIsRetryable(err: unknown): boolean {
  return isNetworkError(err) || isTransientHttpError(err);
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label = "operation"): Promise<T> {
  if (timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`timed out after ${timeoutMs}ms: ${label}`, { retryable: true })), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 250;
  const maxDelayMs = opts.maxDelayMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 0;
  const isRetryable = opts.isRetryable ?? defaultIsRetryable;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const promise = fn();
      return await (timeoutMs > 0 ? withTimeout(promise, timeoutMs) : promise);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isRetryable(err)) throw err;
      // Bounded exponential backoff with full jitter.
      const expo = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.random() * expo;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}