import { getPool } from "../database/db.js";
import { appendAccountEvent, getSnapshot, type AccountEventType } from "./account-intelligence.js";
import { getPipelineService } from "../runs/pipeline-service.js";

/**
 * STEP 61 — Continuous tracked-account source refresh.
 *
 * For accounts already tracked by Revenue Execution OS, selectively read their
 * connected operational state (HubSpot deal/tasks/notes, HubSpot commercial
 * context, known Gmail threads) — never the user's entire mailbox — and, when
 * material source state changes, emit an AccountEvent that rebuilds Account
 * Intelligence and re-runs the scanner.
 */

export interface SourceState {
  stage: string | null;
  commercialStatus: string | null;
  /** Ids of currently-open HubSpot tasks. */
  openTaskIds: string[];
  /** Known/relevant Gmail thread ids associated with the account. */
  gmailThreadIds: string[];
  /** Sources that failed to load this refresh (must not be fabricated). */
  unavailableSources: string[];
}

export const EMPTY_SOURCE_STATE: SourceState = {
  stage: null,
  commercialStatus: null,
  openTaskIds: [],
  gmailThreadIds: [],
  unavailableSources: [],
};

export interface DetectedChange {
  eventType: AccountEventType;
  payload: Record<string, unknown>;
  source: string;
  provenance: string;
}

/** Deterministic normalized fingerprint of the relevant source state. */
export function fingerprintSource(s: SourceState): string {
  return JSON.stringify({
    stage: s.stage,
    commercialStatus: s.commercialStatus,
    openTaskIds: [...s.openTaskIds].sort(),
    gmailThreadIds: [...s.gmailThreadIds].sort(),
    unavailableSources: [...s.unavailableSources].sort(),
  });
}

/**
 * Pure, deterministic change detection. Returns the AccountEvents to emit; empty
 * when nothing material changed. Never fabricates a value for an unavailable
 * source (it emits an "unavailable" marker instead).
 */
export function detectChanges(previous: SourceState, current: SourceState): DetectedChange[] {
  const changes: DetectedChange[] = [];
  const prevUnavail = new Set(previous.unavailableSources ?? []);
  const currUnavail = new Set(current.unavailableSources ?? []);

  for (const src of ["hubspot", "commercial"] as const) {
    if (currUnavail.has(src) && !prevUnavail.has(src)) {
      if (src === "hubspot") changes.push({ eventType: "crm_state_observed", payload: { unavailable: true }, source: "hubspot", provenance: "account_refresh" });
      else changes.push({ eventType: "commercial_state_observed", payload: { unavailable: true }, source: "commercial", provenance: "account_refresh" });
    }
  }

  if (!currUnavail.has("hubspot") && (current.stage ?? null) !== (previous.stage ?? null)) {
    changes.push({ eventType: "crm_state_observed", payload: { stage: current.stage }, source: "hubspot", provenance: "account_refresh" });
  }
  if (!currUnavail.has("commercial") && (current.commercialStatus ?? null) !== (previous.commercialStatus ?? null)) {
    changes.push({ eventType: "commercial_state_observed", payload: { status: current.commercialStatus }, source: "commercial", provenance: "account_refresh" });
  }

  const prevTasks = new Set(previous.openTaskIds ?? []);
  const currTasks = new Set(current.openTaskIds ?? []);
  for (const id of prevTasks) {
    if (!currTasks.has(id)) {
      changes.push({ eventType: "task_completed", payload: { taskId: id }, source: "hubspot", provenance: "account_refresh" });
    }
  }

  const prevThreads = new Set(previous.gmailThreadIds ?? []);
  for (const id of current.gmailThreadIds ?? []) {
    if (!prevThreads.has(id)) {
      changes.push({ eventType: "email_observed", payload: { reference: id }, source: "gmail", provenance: "account_refresh" });
    }
  }

  return changes;
}

export interface AccountRefreshDeps {
  readSource: (userId: string, accountId: string) => Promise<SourceState>;
  loadPrevious: (userId: string, accountId: string) => Promise<SourceState | null>;
  savePrevious: (userId: string, accountId: string, state: SourceState) => Promise<void>;
  emit: (userId: string, accountId: string, change: DetectedChange) => Promise<void>;
}

/**
 * Refresh one tracked account: read source, detect changes, emit AccountEvents
 * for material changes (idempotent), and persist the new fingerprint.
 */
export async function refreshAccount(userId: string, accountId: string, deps: AccountRefreshDeps): Promise<DetectedChange[]> {
  const current = await deps.readSource(userId, accountId);
  const previous = (await deps.loadPrevious(userId, accountId)) ?? EMPTY_SOURCE_STATE;

  // Fast path: identical fingerprint → nothing to do (no new event).
  if (fingerprintSource(previous) === fingerprintSource(current)) {
    return [];
  }

  const changes = detectChanges(previous, current);
  for (const c of changes) {
    await deps.emit(userId, accountId, c);
  }
  await deps.savePrevious(userId, accountId, current);
  return changes;
}

// ---------------------------------------------------------------------------
// Real provider reads + DB persistence (the "same real refresh pipeline")
// ---------------------------------------------------------------------------

export async function readTrackedSource(userId: string, accountId: string): Promise<SourceState> {
  const service = getPipelineService();
  if (!service) return { ...EMPTY_SOURCE_STATE, unavailableSources: ["hubspot", "commercial"] };

  const ctx = await service.resolveReadContext(userId);
  const state: SourceState = { ...EMPTY_SOURCE_STATE };

  try {
    const deal = await ctx.crm.getOpenDeal(accountId);
    state.stage = deal?.stage ?? null;
  } catch {
    state.unavailableSources.push("hubspot");
  }
  try {
    const commercial = await ctx.commercial.getCommercialState(accountId);
    state.commercialStatus = commercial?.subscription?.status ?? null;
  } catch {
    state.unavailableSources.push("commercial");
  }
  try {
    const tasks = await ctx.crm.getOpenTasks(accountId);
    state.openTaskIds = tasks.map((t) => t.id);
  } catch {
    state.unavailableSources.push("hubspot");
  }

  // Known Gmail threads only (from persisted commitment email references) — never a mailbox scan.
  const snapshot = await getSnapshot(userId, accountId).catch(() => null);
  const refs = (snapshot?.commitments ?? []).flatMap((c) => c.relatedEmailIds ?? []);
  state.gmailThreadIds = [...new Set(refs.filter((x): x is string => !!x))];

  return state;
}

async function loadPrevious(userId: string, accountId: string): Promise<SourceState | null> {
  const pool = getPool();
  const res = await pool.query("SELECT state FROM account_refresh_state WHERE user_id = $1 AND account_id = $2", [userId, accountId]);
  return (res.rows[0] as { state: SourceState } | undefined)?.state ?? null;
}

async function savePrevious(userId: string, accountId: string, state: SourceState): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO account_refresh_state (user_id, account_id, state, updated_at)
     VALUES ($1,$2,$3::jsonb,now())
     ON CONFLICT (user_id, account_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [userId, accountId, JSON.stringify(state)],
  );
}

async function emitChange(userId: string, accountId: string, change: DetectedChange): Promise<void> {
  await appendAccountEvent({
    userId,
    accountId,
    eventType: change.eventType,
    source: change.source,
    payload: change.payload,
    provenance: change.provenance,
    idempotencyKey: `refresh:${userId}:${accountId}:${change.eventType}:${fingerprintSource({ ...EMPTY_SOURCE_STATE, ...change.payload } as SourceState)}`,
  }).catch(() => undefined);
}

/** Run the real refresh pipeline for one tracked account (used by worker + manual + test util). */
export async function refreshTrackedAccount(userId: string, accountId: string): Promise<DetectedChange[]> {
  return refreshAccount(userId, accountId, {
    readSource: readTrackedSource,
    loadPrevious,
    savePrevious,
    emit: emitChange,
  });
}

/** Distinct tracked accounts (recently active or with open findings/commitments). */
export async function listTrackedAccounts(): Promise<{ userId: string; accountId: string }[]> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT ai.user_id, ai.account_id
       FROM account_intelligence ai
      WHERE ai.updated_at > now() - interval '30 days'
      UNION
     SELECT rf.user_id, rf.account_id
       FROM risk_findings rf
      WHERE rf.status = 'open'`,
  );
  return (res.rows as { user_id: string; account_id: string }[]).map((r) => ({ userId: r.user_id, accountId: r.account_id }));
}
