import type { AuditEvent, AuditSink, ExecutionRecord, ExecutionStore } from "./core.js";
import { getPool } from "./db.js";
import type { RunStore, StoredProposal, StoredRun } from "./store.js";

/**
 * Postgres-backed RunStore. Runs and proposals are stored as whole JSON payloads
 * in `app_runs` / `app_proposals`, keyed by an owning `user_id`. Ownership is a
 * column so reads can enforce it server-side.
 */
export class PostgresRunStore implements RunStore {
  async saveRun(run: StoredRun, userId: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO app_runs (id, user_id, mode, status, account_id, created_at, error, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, error = EXCLUDED.error, payload = EXCLUDED.payload`,
      [run.id, userId, run.mode, run.status, run.accountId ?? null, run.createdAt, run.error ?? null, JSON.stringify(run)],
    );
  }

  async getRun(runId: string): Promise<{ run: StoredRun; userId: string } | null> {
    const pool = getPool();
    const res = await pool.query("SELECT user_id, payload FROM app_runs WHERE id = $1", [runId]);
    const row = res.rows[0] as { user_id: string; payload: StoredRun } | undefined;
    return row ? { run: row.payload, userId: row.user_id } : null;
  }

  async listRuns(userId: string): Promise<StoredRun[]> {
    const pool = getPool();
    const res = await pool.query("SELECT payload FROM app_runs WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
    return (res.rows as { payload: StoredRun }[]).map((r) => r.payload);
  }

  async saveProposal(proposal: StoredProposal, runId: string, userId: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO app_proposals (id, user_id, run_id, status, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload`,
      [proposal.id, userId, runId, proposal.status, JSON.stringify(proposal)],
    );
  }

  async getProposal(proposalId: string): Promise<{ proposal: StoredProposal; runId: string; userId: string } | null> {
    const pool = getPool();
    const res = await pool.query("SELECT user_id, run_id, payload FROM app_proposals WHERE id = $1", [proposalId]);
    const row = res.rows[0] as { user_id: string; run_id: string; payload: StoredProposal } | undefined;
    return row ? { proposal: row.payload, runId: row.run_id, userId: row.user_id } : null;
  }
}

/**
 * User-scoped Postgres audit sink. Payloads arrive already redacted by
 * AuditService (which strips tokens and chain-of-thought), so nothing sensitive
 * is persisted here.
 */
export class PostgresAuditSink implements AuditSink {
  constructor(private readonly userId: string) {}

  async write(event: AuditEvent): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO app_audit (user_id, run_id, event_type, actor, level, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [this.userId, event.runId ?? null, event.eventType, event.actor ?? null, event.level, JSON.stringify(event.payload ?? {}), event.createdAt],
    );
  }
}

/**
 * User-scoped Postgres execution idempotency store. Persists execution records
 * so a restarted API never re-executes an already-executed proposal.
 */
export class PostgresExecutionStore implements ExecutionStore {
  constructor(private readonly userId: string) {}

  async getByExecutionId(id: string): Promise<ExecutionRecord | undefined> {
    const pool = getPool();
    const res = await pool.query("SELECT result, proposal_signature FROM app_executions WHERE execution_id = $1", [id]);
    const row = res.rows[0] as { result: ExecutionRecord["result"]; proposal_signature: string } | undefined;
    return row ? { executionId: id, proposalSignature: row.proposal_signature, result: row.result } : undefined;
  }

  async getBySignature(signature: string): Promise<ExecutionRecord | undefined> {
    const pool = getPool();
    const res = await pool.query("SELECT execution_id, result FROM app_executions WHERE proposal_signature = $1", [signature]);
    const row = res.rows[0] as { execution_id: string; result: ExecutionRecord["result"] } | undefined;
    return row ? { executionId: row.execution_id, proposalSignature: signature, result: row.result } : undefined;
  }

  async put(record: ExecutionRecord): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO app_executions (execution_id, user_id, proposal_signature, result)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (execution_id) DO NOTHING`,
      [record.executionId, this.userId, record.proposalSignature, JSON.stringify(record.result)],
    );
  }
}
