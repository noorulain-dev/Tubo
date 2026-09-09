import { randomUUID } from "node:crypto";

import type { ContextGapType, ContextProvenance } from "./context-resolution.js";

/**
 * Append-only audit log of human-supplied context.
 *
 * This table is evidence, not state: the resulting facts live in the account
 * event log like everything else. Rows are never updated or deleted, so the
 * original ambiguity is always recoverable.
 */

export interface ContextResolutionRecord {
  resolutionId: string;
  userId: string;
  accountId: string;
  gapId: string;
  gapType: ContextGapType;
  subjectKind: string;
  subjectId: string;
  subjectLabel: string;
  /** The question as it was posed, preserved verbatim. */
  question: string;
  /** What Tubo could not verify at the time — kept so history reads honestly. */
  originalAmbiguity: string[];
  choiceKind: "option" | "date" | "unresolved";
  selectedLabel: string;
  selectedValue: Record<string, unknown>;
  provenance: ContextProvenance;
  resolvedBy: string;
  resolvedByName: string | null;
  resolvedAt: string;
  /** The account event this resolution produced, when it changed state. */
  accountEventId: string | null;
  runId: string | null;
  findingId: string | null;
}

export type NewContextResolution = Omit<ContextResolutionRecord, "resolutionId" | "resolvedAt"> & {
  resolutionId?: string;
  resolvedAt?: string;
};

/**
 * The database module is imported lazily so that pure, DB-less unit tests can
 * exercise this repository without booting the runtime config/pool.
 */
function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

async function pool() {
  const { getPool } = await import("../database/db.js");
  return getPool();
}

/** In-memory fallback for the no-database mode the API already supports. */
const memory: ContextResolutionRecord[] = [];

function rowTo(r: Record<string, unknown>): ContextResolutionRecord {
  return {
    resolutionId: String(r.resolution_id),
    userId: String(r.user_id),
    accountId: String(r.account_id),
    gapId: String(r.gap_id),
    gapType: String(r.gap_type) as ContextGapType,
    subjectKind: String(r.subject_kind),
    subjectId: String(r.subject_id),
    subjectLabel: String(r.subject_label ?? ""),
    question: String(r.question ?? ""),
    originalAmbiguity: (r.original_ambiguity as string[]) ?? [],
    choiceKind: String(r.choice_kind) as ContextResolutionRecord["choiceKind"],
    selectedLabel: String(r.selected_label ?? ""),
    selectedValue: (r.selected_value as Record<string, unknown>) ?? {},
    provenance: String(r.provenance) as ContextProvenance,
    resolvedBy: String(r.resolved_by),
    resolvedByName: (r.resolved_by_name as string) ?? null,
    resolvedAt: new Date(r.resolved_at as string).toISOString(),
    accountEventId: (r.account_event_id as string) ?? null,
    runId: (r.run_id as string) ?? null,
    findingId: (r.finding_id as string) ?? null,
  };
}

export async function recordContextResolution(input: NewContextResolution): Promise<ContextResolutionRecord> {
  const record: ContextResolutionRecord = {
    ...input,
    resolutionId: input.resolutionId ?? `ctxres_${randomUUID()}`,
    resolvedAt: input.resolvedAt ?? new Date().toISOString(),
  };

  if (!isDbConfigured()) {
    memory.push(record);
    return record;
  }

  const db = await pool();
  await db.query(
    `INSERT INTO context_resolutions (
       resolution_id, user_id, account_id, gap_id, gap_type, subject_kind, subject_id, subject_label,
       question, original_ambiguity, choice_kind, selected_label, selected_value, provenance,
       resolved_by, resolved_by_name, resolved_at, account_event_id, run_id, finding_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (resolution_id) DO NOTHING`,
    [
      record.resolutionId,
      record.userId,
      record.accountId,
      record.gapId,
      record.gapType,
      record.subjectKind,
      record.subjectId,
      record.subjectLabel,
      record.question,
      JSON.stringify(record.originalAmbiguity),
      record.choiceKind,
      record.selectedLabel,
      JSON.stringify(record.selectedValue),
      record.provenance,
      record.resolvedBy,
      record.resolvedByName,
      record.resolvedAt,
      record.accountEventId,
      record.runId,
      record.findingId,
    ],
  );
  return record;
}

/** Tenant-scoped by construction: userId is always part of the predicate. */
export async function listContextResolutions(userId: string, accountId: string): Promise<ContextResolutionRecord[]> {
  if (!isDbConfigured()) {
    return memory.filter((r) => r.userId === userId && r.accountId === accountId).sort((a, b) => (a.resolvedAt < b.resolvedAt ? 1 : -1));
  }
  const db = await pool();
  const res = await db.query(
    "SELECT * FROM context_resolutions WHERE user_id = $1 AND account_id = $2 ORDER BY resolved_at DESC",
    [userId, accountId],
  );
  return (res.rows as Record<string, unknown>[]).map(rowTo);
}

export async function listAllContextResolutions(userId: string): Promise<ContextResolutionRecord[]> {
  if (!isDbConfigured()) {
    return memory.filter((r) => r.userId === userId).sort((a, b) => (a.resolvedAt < b.resolvedAt ? 1 : -1));
  }
  const db = await pool();
  const res = await db.query("SELECT * FROM context_resolutions WHERE user_id = $1 ORDER BY resolved_at DESC LIMIT 500", [userId]);
  return (res.rows as Record<string, unknown>[]).map(rowTo);
}

/** Test-only helper for the in-memory mode. */
export function __resetContextResolutionMemory(): void {
  memory.length = 0;
}
