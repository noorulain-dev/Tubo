import { randomUUID } from "node:crypto";
import { getPool } from "../database/db.js";
import {
  buildState,
  EMPTY_SNAPSHOT,
  type AccountEvent,
  type AccountEventType,
  type AccountIntelligenceSnapshot,
} from "./state-builder.js";
import { scanAndPersistAccount } from "./risk-scanner.js";

export type { AccountEvent, AccountEventType, AccountIntelligenceSnapshot } from "./state-builder.js";
export { EMPTY_SNAPSHOT, buildState, reduceEvent } from "./state-builder.js";

export interface RecordEventInput {
  userId: string;
  accountId: string | null;
  eventType: AccountEventType;
  occurredAt?: string;
  source?: string | null;
  sourceReference?: string | null;
  payload?: Record<string, unknown>;
  provenance?: string | null;
  idempotencyKey: string;
}

export async function recordAccountEvent(input: RecordEventInput): Promise<{ eventId: string; created: boolean }> {
  const pool = getPool();
  const id = randomUUID();
  const res = await pool.query(
    `INSERT INTO account_events (event_id, user_id, account_id, event_type, occurred_at, source, source_reference, payload, provenance, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      id,
      input.userId,
      input.accountId,
      input.eventType,
      input.occurredAt ?? new Date().toISOString(),
      input.source ?? null,
      input.sourceReference ?? null,
      JSON.stringify(input.payload ?? {}),
      input.provenance ?? null,
      input.idempotencyKey,
    ],
  );
  if (res.rowCount === 1) return { eventId: id, created: true };
  const existing = await pool.query("SELECT event_id FROM account_events WHERE idempotency_key = $1", [input.idempotencyKey]);
  return { eventId: (existing.rows[0] as { event_id: string })?.event_id ?? id, created: false };
}

function rowToEvent(r: Record<string, unknown>): AccountEvent {
  return {
    eventId: String(r.event_id),
    userId: String(r.user_id),
    accountId: (r.account_id as string) ?? null,
    eventType: String(r.event_type) as AccountEventType,
    occurredAt: new Date(r.occurred_at as string).toISOString(),
    source: (r.source as string) ?? null,
    sourceReference: (r.source_reference as string) ?? null,
    payload: (r.payload as Record<string, unknown>) ?? {},
    provenance: (r.provenance as string) ?? null,
  };
}

export async function listAccountEvents(userId: string, accountId: string): Promise<AccountEvent[]> {
  const pool = getPool();
  const res = await pool.query(
    "SELECT event_id, user_id, account_id, event_type, occurred_at, source, source_reference, payload, provenance FROM account_events WHERE user_id = $1 AND account_id = $2 ORDER BY occurred_at DESC",
    [userId, accountId],
  );
  return (res.rows as Record<string, unknown>[]).map(rowToEvent);
}

export async function getSnapshot(userId: string, accountId: string): Promise<AccountIntelligenceSnapshot> {
  const pool = getPool();
  const res = await pool.query("SELECT state, version FROM account_intelligence WHERE user_id = $1 AND account_id = $2", [userId, accountId]);
  const row = res.rows[0] as { state: AccountIntelligenceSnapshot; version: number } | undefined;
  return row ? { ...EMPTY_SNAPSHOT, ...row.state, version: row.version } : { ...EMPTY_SNAPSHOT };
}

export async function saveSnapshot(userId: string, accountId: string, snapshot: AccountIntelligenceSnapshot): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO account_intelligence (account_id, user_id, state, version, updated_at)
     VALUES ($1,$2,$3::jsonb,$4,now())
     ON CONFLICT (user_id, account_id) DO UPDATE SET state = EXCLUDED.state, version = EXCLUDED.version, updated_at = now()`,
    [accountId, userId, JSON.stringify(snapshot), snapshot.version],
  );
}

/**
 * Record an event (idempotent) and rebuild the account snapshot deterministically
 * from the FULL ordered event history. This makes the snapshot reproducible and
 * naturally immune to duplicate/out-of-order events: state is the fold of all
 * events for the account, not an incremental mutation.
 */
export async function appendAccountEvent(input: RecordEventInput): Promise<{ eventId: string; created: boolean; version: number }> {
  const { eventId, created } = await recordAccountEvent(input);
  if (!input.accountId) return { eventId, created, version: 0 };

  const events = await listAccountEvents(input.userId, input.accountId);
  const snapshot = buildState(events);
  await saveSnapshot(input.userId, input.accountId, snapshot);
  // Trigger the risk scanner after a material account-state update (idempotent).
  await scanAndPersistAccount(input.userId, input.accountId, snapshot).catch(() => undefined);
  return { eventId, created, version: snapshot.version };
}

export async function listAccounts(userId: string): Promise<string[]> {
  const pool = getPool();
  const res = await pool.query("SELECT DISTINCT account_id FROM account_intelligence WHERE user_id = $1 AND account_id IS NOT NULL", [userId]);
  return (res.rows as { account_id: string }[]).map((r) => r.account_id);
}
