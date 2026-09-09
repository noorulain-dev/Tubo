import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPool, withTransaction } from "./client.js";

/**
 * Lightweight migration runner (no ORM). `db/migrations/*.sql` is the canonical
 * forward versioned history; this applies each file exactly once, in filename
 * order, each inside its own transaction, tracked by `schema_migrations`.
 */
export async function runMigrations(migrationsDir: string): Promise<string[]> {
  const pool = getPool();
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const already = await pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
    if ((already.rowCount ?? 0) > 0) continue;

    const sql = readFileSync(resolve(migrationsDir, file), "utf8");
    await withTransaction(async (tx) => {
      await tx.query(sql);
      await tx.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING", [version]);
    });
    applied.push(version);
  }
  return applied;
}