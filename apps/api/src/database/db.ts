// Single database facade. Re-exports the centralized client, the idempotent
// schema bootstrap, and the lightweight forward migration runner.
export { getPool, isDbConfigured, pingDb, withTransaction } from "./client.js";
export { ensureSchema } from "./schema-bootstrap.js";
export { runMigrations } from "./migrate.js";
