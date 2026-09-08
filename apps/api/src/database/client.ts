import pg, { type PoolClient } from "pg";
import { logger } from "../observability/logger.js";

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** The single Postgres connection pool for the whole API. Feature modules must
 * never construct their own `new Pool` — they call `getPool()` (or the query
 * helpers below). */
export function getPool(): InstanceType<typeof Pool> {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set. Configure it in .env before starting the API.");
    }
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

/**
 * Run `fn` inside a transaction. Guarantees BEGIN/COMMIT on success, ROLLBACK on
 * error, and client release in a finally — the client is never leaked.
 */
export async function withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure; the connection is released below.
    }
    logger.error({ event: "db_transaction_failed", error_code: (err as { code?: string } | undefined)?.code, message: err instanceof Error ? err.message : String(err) }, "transaction failed and was rolled back");
    throw err;
  } finally {
    client.release();
  }
}

/** Centralized, read-only database health check (used by /ready). Logs only the
 * error code/message — never query values or row data. */
export async function pingDb(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch (err) {
    logger.error({ event: "db_ping_failed", error_code: (err as { code?: string } | undefined)?.code, message: err instanceof Error ? err.message : String(err) }, "database ping failed");
    return false;
  }
}