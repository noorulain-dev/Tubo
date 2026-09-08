import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

export type JobType = "calendar.sync" | "fireflies.sync" | "fireflies.fetch" | "interaction.process" | "account.refresh";
export type JobStatus = "scheduled" | "running" | "retrying" | "completed" | "failed" | "cancelled";

export interface Job {
  id: string;
  userId: string;
  type: JobType;
  resourceRef: string | null;
  payload: Record<string, unknown>;
  scheduledAt: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  idempotencyKey: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Bounded exponential backoff, capped at 60s. */
export function backoffDelayMs(attempt: number): number {
  return Math.min(250 * 2 ** Math.max(0, attempt), 60_000);
}

/** Transient error codes are retried; everything else is treated as permanent. */
export function isTransientErrorCode(code: string | null | undefined): boolean {
  return code === "RATE_LIMITED" || code === "PROVIDER_5XX" || code === "TIMEOUT";
}

/** Retry only transient failures with remaining attempts (no infinite retry). */
export function shouldRetry(transient: boolean, attempts: number, maxAttempts: number): boolean {
  return transient && attempts < maxAttempts;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export interface EnqueueInput {
  type: JobType;
  userId: string;
  resourceRef?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  scheduledAt?: Date;
  maxAttempts?: number;
}

export async function enqueue(input: EnqueueInput): Promise<{ id: string; created: boolean }> {
  const pool = getPool();
  const id = randomUUID();
  const res = await pool.query(
    `INSERT INTO jobs (id, user_id, type, resource_ref, payload, scheduled_at, idempotency_key, max_attempts)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      id,
      input.userId,
      input.type,
      input.resourceRef ?? null,
      JSON.stringify(input.payload ?? {}),
      (input.scheduledAt ?? new Date()).toISOString(),
      input.idempotencyKey,
      input.maxAttempts ?? 5,
    ],
  );
  if (res.rowCount === 1) return { id, created: true };
  const existing = await pool.query("SELECT id FROM jobs WHERE idempotency_key = $1", [input.idempotencyKey]);
  return { id: existing.rows[0]?.id ?? id, created: false };
}

/** Atomically claim up to `limit` ready jobs (FOR UPDATE SKIP LOCKED). */
export async function claimNext(types: JobType[], limit = 5): Promise<Job[]> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<Job>(
      `SELECT id, user_id, type, resource_ref, payload, scheduled_at, status, attempts, max_attempts,
              last_error_code, idempotency_key, created_at, started_at, completed_at
       FROM jobs
       WHERE type = ANY($1::text[]) AND status IN ('scheduled','retrying') AND scheduled_at <= now()
       ORDER BY scheduled_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [types, limit],
    );
    const jobs = res.rows;
    for (const j of jobs) {
      await client.query("UPDATE jobs SET status = 'running', started_at = now(), attempts = attempts + 1 WHERE id = $1", [j.id]);
    }
    await client.query("COMMIT");
    return jobs;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function completeJob(jobId: string): Promise<void> {
  await getPool().query("UPDATE jobs SET status = 'completed', completed_at = now() WHERE id = $1", [jobId]);
}

/** Mark failed; retry only transient errors with remaining attempts. */
export async function failJob(jobId: string, errorCode: string, transient: boolean): Promise<JobStatus> {
  const pool = getPool();
  const res = await pool.query("SELECT attempts, max_attempts FROM jobs WHERE id = $1", [jobId]);
  const j = res.rows[0] as { attempts: number; max_attempts: number } | undefined;
  if (!j) return "failed";
  if (shouldRetry(transient, j.attempts, j.max_attempts)) {
    const delay = backoffDelayMs(j.attempts);
    await pool.query(
      "UPDATE jobs SET status = 'retrying', last_error_code = $2, scheduled_at = now() + ($3 * interval '1 millisecond') WHERE id = $1",
      [jobId, errorCode, delay],
    );
    return "retrying";
  }
  await pool.query("UPDATE jobs SET status = 'failed', last_error_code = $2, completed_at = now() WHERE id = $1", [jobId, errorCode]);
  return "failed";
}

export async function emitJobEvent(jobId: string, userId: string, eventType: string): Promise<void> {
  await getPool().query("INSERT INTO job_events (job_id, user_id, event_type) VALUES ($1, $2, $3)", [jobId, userId, eventType]);
}

/**
 * Reclaim jobs left "running" by a crashed worker (no heartbeat). Returns the
 * number of jobs re-queued. A conservative default of 10 minutes avoids racing a
 * healthy but slow job.
 */
export async function reclaimStaleRunning(staleAfterMs = 10 * 60 * 1000): Promise<number> {
  const pool = getPool();
  const res = await pool.query(
    `UPDATE jobs SET status = 'retrying', started_at = NULL
      WHERE status = 'running' AND started_at < now() - ($1 * interval '1 millisecond')`,
    [staleAfterMs],
  );
  return res.rowCount ?? 0;
}

/** Distinct user ids having a given connection provider (for periodic scan). */
export async function listConnectedUserIds(provider: string): Promise<string[]> {
  const pool = getPool();
  const res = await pool.query("SELECT DISTINCT user_id FROM connections WHERE provider = $1 AND status = 'connected'", [provider]);
  return (res.rows as { user_id: string }[]).map((r) => r.user_id);
}
