import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

export type AccountEventType =
  | "interaction_processed"
  | "meeting_processed"
  | "manual_interaction_processed"
  | "email_observed"
  | "crm_state_observed"
  | "task_created"
  | "task_completed"
  | "commercial_state_observed"
  | "proposal_approved"
  | "proposal_rejected"
  | "external_action_executed"
  | "manual_correction";

export interface AccountEvent {
  eventId: string;
  userId: string;
  accountId: string | null;
  eventType: AccountEventType;
  occurredAt: string;
  source: string | null;
  sourceReference: string | null;
  payload: Record<string, unknown>;
  provenance: string | null;
}

export interface AccountIntelligenceSnapshot {
  identity: { companyId?: string; contactId?: string; dealId?: string; name?: string } | null;
  stage: string | null;
  commercial: { status?: string; provenance?: string | null } | null;
  decisions: unknown[];
  openCommitments: unknown[];
  openQuestions: unknown[];
  blockers: string[];
  nextSteps: unknown[];
  recentEvents: { eventType: AccountEventType; occurredAt: string }[];
  executionGaps: unknown[];
  lastReviewed: string | null;
  lastSourceRefresh: string | null;
  version: number;
}

export const EMPTY_SNAPSHOT: AccountIntelligenceSnapshot = {
  identity: null,
  stage: null,
  commercial: null,
  decisions: [],
  openCommitments: [],
  openQuestions: [],
  blockers: [],
  nextSteps: [],
  recentEvents: [],
  executionGaps: [],
  lastReviewed: null,
  lastSourceRefresh: null,
  version: 0,
};

/** Pure, append-only state derivation. Never erases history. */
export function applyEvent(snapshot: AccountIntelligenceSnapshot, event: AccountEvent): AccountIntelligenceSnapshot {
  const next: AccountIntelligenceSnapshot = { ...snapshot, version: snapshot.version + 1 };
  next.recentEvents = [{ eventType: event.eventType, occurredAt: event.occurredAt }, ...snapshot.recentEvents].slice(0, 50);
  switch (event.eventType) {
    case "crm_state_observed":
      next.stage = (event.payload.stage as string) ?? snapshot.stage;
      next.lastSourceRefresh = event.occurredAt;
      break;
    case "commercial_state_observed":
      next.commercial = { status: event.payload.status as string | undefined, provenance: event.provenance ?? null };
      next.lastSourceRefresh = event.occurredAt;
      break;
    case "proposal_approved":
    case "proposal_rejected":
    case "manual_correction":
      next.lastReviewed = event.occurredAt;
      break;
    default:
      break;
  }
  return next;
}

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

export async function listAccountEvents(userId: string, accountId: string): Promise<AccountEvent[]> {
  const pool = getPool();
  const res = await pool.query(
    "SELECT event_id, user_id, account_id, event_type, occurred_at, source, source_reference, payload, provenance FROM account_events WHERE user_id = $1 AND account_id = $2 ORDER BY occurred_at DESC",
    [userId, accountId],
  );
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    eventId: String(r.event_id),
    userId: String(r.user_id),
    accountId: (r.account_id as string) ?? null,
    eventType: String(r.event_type) as AccountEventType,
    occurredAt: new Date(r.occurred_at as string).toISOString(),
    source: (r.source as string) ?? null,
    sourceReference: (r.source_reference as string) ?? null,
    payload: (r.payload as Record<string, unknown>) ?? {},
    provenance: (r.provenance as string) ?? null,
  }));
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

/** Record an event and derive the next snapshot version (idempotent). */
export async function appendAccountEvent(input: RecordEventInput): Promise<{ eventId: string; created: boolean; version: number }> {
  const { eventId, created } = await recordAccountEvent(input);
  if (!input.accountId) return { eventId, created, version: 0 };
  const current = await getSnapshot(input.userId, input.accountId);
  const next = applyEvent(current, {
    eventId,
    userId: input.userId,
    accountId: input.accountId,
    eventType: input.eventType,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    source: input.source ?? null,
    sourceReference: input.sourceReference ?? null,
    payload: input.payload ?? {},
    provenance: input.provenance ?? null,
  });
  await saveSnapshot(input.userId, input.accountId, next);
  return { eventId, created, version: next.version };
}

export async function listAccounts(userId: string): Promise<string[]> {
  const pool = getPool();
  const res = await pool.query("SELECT DISTINCT account_id FROM account_intelligence WHERE user_id = $1 AND account_id IS NOT NULL", [userId]);
  return (res.rows as { account_id: string }[]).map((r) => r.account_id);
}
