import { AuditService, NoopAuditSink } from "../audit-service.js";
import {
  AuthenticationError,
  PermissionError,
  ProviderError,
  RateLimitError,
  ValidationError,
} from "../errors.js";

export interface FetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<FetchResponse>;

export interface HubSpotClientOptions {
  accessToken: string;
  baseUrl?: string;
  fetch?: FetchLike;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  audit?: AuditService;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface HubSpotPagedResponse {
  results?: unknown[];
  paging?: { next?: { after?: string } };
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_MAX_RETRIES = 3;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Thin HubSpot HTTP client. Responsibilities:
 *  - auth header (token never logged/exposed)
 *  - bounded retry with backoff for 429 + 5xx and network failures
 *  - no retry for 400/401/403/404/422
 *  - error mapping into structured AppErrors
 *  - pagination helper
 *  - latency + audit logging (no secrets)
 */
export class HubSpotHttpClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly audit: AuditService;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: HubSpotClientOptions) {
    this.accessToken = opts.accessToken;
    this.baseUrl = (opts.baseUrl ?? "https://api.hubapi.com").replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = opts.baseDelayMs ?? 250;
    this.maxDelayMs = opts.maxDelayMs ?? 4000;
    this.timeoutMs = opts.timeoutMs ?? 10000;
    this.audit = opts.audit ?? new AuditService(new NoopAuditSink());
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? defaultSleep;
  }

  async get(path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
    return this.request("GET", path, { query });
  }

  async post(path: string, body?: unknown, opts?: { idempotencyKey?: string }): Promise<unknown> {
    return this.request("POST", path, { body, idempotencyKey: opts?.idempotencyKey });
  }

  async patch(path: string, body?: unknown): Promise<unknown> {
    return this.request("PATCH", path, { body });
  }

  async put(path: string, body?: unknown): Promise<unknown> {
    return this.request("PUT", path, { body });
  }

  /** Follows HubSpot search/listing pagination via `paging.next.after`. */
  async searchAll(path: string, body: unknown): Promise<unknown[]> {
    const out: unknown[] = [];
    let after: string | undefined;
    do {
      const payload = after
        ? { ...(body as Record<string, unknown>), after }
        : (body as Record<string, unknown>);
      const res = (await this.post(path, payload)) as HubSpotPagedResponse;
      if (Array.isArray(res.results)) {
        out.push(...res.results);
      }
      after = res.paging?.next?.after;
    } while (after);
    return out;
  }

  private async request(
    method: string,
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown; idempotencyKey?: string },
  ): Promise<unknown> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
    };
    if (opts.idempotencyKey) {
      headers["Idempotency-Key"] = opts.idempotencyKey;
    }

    const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    for (let attempt = 0; ; attempt++) {
      const startedAt = this.now();
      let res: FetchResponse;
      try {
        res = await this.fetchWithTimeout(url.toString(), { method, headers, body });
      } catch (err) {
        // Network-level failure.
        this.audit.emit({
          eventType: "hubspot.request.error",
          level: "warn",
          payload: { method, path, attempt },
        });
        if (attempt < this.maxRetries) {
          await this.sleep(this.backoff(attempt, null));
          continue;
        }
        throw new ProviderError(`HubSpot request failed (${method} ${path})`, {
          cause: err,
          retryable: true,
        });
      }

      const latencyMs = this.now() - startedAt;
      this.audit.emit({
        eventType: "hubspot.request",
        payload: { method, path, status: res.status, latencyMs, attempt },
      });

      if (res.status >= 200 && res.status < 300) {
        return res.status === 204 ? null : await res.json();
      }

      if (RETRYABLE_STATUS.has(res.status) && attempt < this.maxRetries) {
        const retryAfter = res.headers.get("retry-after");
        await this.sleep(this.backoff(attempt, retryAfter));
        continue;
      }

      throw this.toError(res.status, await readBodySafe(res), method, path);
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<FetchResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private backoff(attempt: number, retryAfterHeader: string | null): number {
    const headerMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
    const exponential = this.baseDelayMs * 2 ** attempt;
    const base = Number.isFinite(headerMs) ? headerMs : exponential;
    return Math.min(base, this.maxDelayMs);
  }

  private toError(status: number, body: string, method: string, path: string): Error {
    switch (status) {
      case 401:
        return new AuthenticationError(`HubSpot authentication failed (${method} ${path})`);
      case 403:
        return new PermissionError(`HubSpot permission denied (${method} ${path})`);
      case 429:
        return new RateLimitError(`HubSpot rate limited (${method} ${path})`);
      case 400:
      case 422:
        return new ValidationError(`HubSpot invalid payload (${method} ${path}): ${truncate(body)}`);
      case 404:
        return new ProviderError(`HubSpot resource not found (${method} ${path})`, {
          status: 404,
          details: { notFound: true },
        });
      default:
        return new ProviderError(`HubSpot error ${status} (${method} ${path})`, {
          details: { httpStatus: status, body: truncate(body) },
        });
    }
  }
}

async function readBodySafe(res: FetchResponse): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function truncate(value: string, max = 500): string {
  return value.length > max ? value.slice(0, max) + "…" : value;
}

export function isNotFoundError(err: unknown): boolean {
  return (
    err instanceof ProviderError &&
    (err.details as { notFound?: boolean } | undefined)?.notFound === true
  );
}
