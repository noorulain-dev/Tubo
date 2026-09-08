import { getPool } from "./db.js";
import type { AccountIntelligenceSnapshot, CommitmentState, QuestionState } from "./state-builder.js";

/**
 * STEP 54 — Continuous Revenue Execution Gap / Risk Scanner.
 *
 * Deterministic: given a persisted AccountIntelligenceSnapshot, identify accounts
 * requiring human attention. Reuses Step-50 reconciliation/execution-gap primitives
 * (via snapshot.reconciliationGaps) and Step-53 commitment/question state. It never
 * invents signals; severity is derived only from observable, deterministic inputs
 * (days overdue, question age, commercial/CRM mismatch, trial proximity, blockers,
 * deadline proximity, provider availability).
 */

export type FindingType =
  | "overdue_internal_commitment"
  | "unanswered_customer_question"
  | "missing_operational_task"
  | "stale_crm_state"
  | "commercial_crm_mismatch"
  | "trial_expiring_with_open_blocker"
  | "customer_waiting_on_us"
  | "missing_next_step"
  | "duplicate_action"
  | "contradictory_state"
  | "missing_required_context";

export type Severity = "critical" | "high" | "medium" | "low";
export type FindingStatus = "open" | "resolved";

export interface Finding {
  findingId: string;
  userId: string;
  accountId: string;
  type: FindingType;
  severity: Severity;
  title: string;
  description: string;
  evidence: string[];
  sourceReferences: string[];
  signals: { signal: string; value: string | number }[];
  needsInvestigation: boolean;
  status: FindingStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface ScanInput {
  userId: string;
  accountId: string;
  snapshot: AccountIntelligenceSnapshot;
  now?: string;
}

const DAY_MS = 86_400_000;

function norm(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function hashKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Stable, idempotency-safe key so a finding does not duplicate across rescans. */
export function findingKey(accountId: string, type: FindingType, title: string): string {
  return `f_${hashKey(`${accountId}:${type}:${norm(title)}`)}`;
}

function wholeDays(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

function msBetween(a: string, b: string): number {
  return Date.parse(b) - Date.parse(a);
}

function severityForOverdue(days: number): Severity {
  if (days >= 7) return "critical";
  if (days >= 3) return "high";
  return "medium";
}

function severityForAge(days: number): Severity {
  if (days >= 7) return "high";
  if (days >= 3) return "medium";
  return "low";
}

function baseFinding(input: ScanInput, type: FindingType, title: string, description: string): Finding {
  const now = input.now ?? new Date().toISOString();
  return {
    findingId: findingKey(input.accountId, type, title),
    userId: input.userId,
    accountId: input.accountId,
    type,
    severity: "medium",
    title,
    description,
    evidence: [],
    sourceReferences: [],
    signals: [],
    needsInvestigation: false,
    status: "open",
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
  };
}

function setNeedsInvestigation(f: Finding): Finding {
  f.needsInvestigation = f.severity === "critical" || f.severity === "high" || f.type === "contradictory_state" || f.type === "missing_required_context" || f.type === "commercial_crm_mismatch";
  return f;
}

const PAYING_STATUSES = new Set(["active", "paying", "paid", "past_due"]);
const NON_CONVERTED_STAGES = new Set(["trial", "closed lost", "closedlost"]);

function commercialStatus(s: AccountIntelligenceSnapshot): string {
  return norm(s.commercial?.status ?? "");
}
function stage(s: AccountIntelligenceSnapshot): string {
  return norm(s.stage ?? "");
}

function overdueFindings(input: ScanInput): Finding[] {
  const out: Finding[] = [];
  const now = input.now ?? new Date().toISOString();
  for (const c of input.snapshot.commitments) {
    if (c.type !== "internal" || c.status !== "overdue" || !c.dueDate) continue;
    const days = wholeDays(msBetween(c.dueDate, now));
    const f = baseFinding(input, "overdue_internal_commitment", `Overdue commitment: ${c.description}`, `Internal commitment "${c.description}" is overdue by ${days} day(s).`);
    f.severity = severityForOverdue(days);
    f.signals = [{ signal: "days_overdue", value: days }];
    f.evidence = [`dueDate=${c.dueDate}`];
    f.sourceReferences = c.sourceEvidence.map((e) => e.reference).filter((x): x is string => !!x);
    out.push(setNeedsInvestigation(f));
  }
  return out;
}

function unansweredQuestionFindings(input: ScanInput): Finding[] {
  const out: Finding[] = [];
  const now = input.now ?? new Date().toISOString();
  for (const q of input.snapshot.questions) {
    if (q.status !== "open") continue;
    const days = wholeDays(msBetween(q.askedAt, now));
    const f = baseFinding(input, "unanswered_customer_question", `Unanswered question: ${q.question}`, `Customer question has been open for ${days} day(s) without an answer.`);
    f.severity = severityForAge(days);
    f.signals = [{ signal: "question_age_days", value: days }];
    f.evidence = [`askedAt=${q.askedAt}`];
    out.push(f);
  }
  return out;
}

function missingTaskFindings(input: ScanInput): Finding[] {
  const out: Finding[] = [];
  for (const c of input.snapshot.commitments) {
    if ((c.status === "open" || c.status === "in_progress") && c.relatedTaskIds.length === 0) {
      const f = baseFinding(input, "missing_operational_task", `Missing task: ${c.description}`, `Commitment "${c.description}" has no linked operational task.`);
      f.severity = "medium";
      f.signals = [{ signal: "commitment", value: c.description }];
      out.push(f);
    }
  }
  return out;
}

function staleCrmFindings(input: ScanInput): Finding[] {
  const s = input.snapshot;
  if (s.stage == null) return [];
  const now = input.now ?? new Date().toISOString();
  const refreshed = s.lastSourceRefresh;
  if (!refreshed) return [];
  const days = wholeDays(msBetween(refreshed, now));
  if (days < 7) return [];
  const f = baseFinding(input, "stale_crm_state", `Stale CRM state (${days} days)`, `CRM state has not been refreshed for ${days} days.`);
  f.severity = days >= 30 ? "medium" : "low";
  f.signals = [{ signal: "days_stale", value: days }];
  return [f];
}

function mismatchFindings(input: ScanInput): Finding[] {
  const s = input.snapshot;
  const paying = PAYING_STATUSES.has(commercialStatus(s));
  const nonConverted = NON_CONVERTED_STAGES.has(stage(s));
  if (!paying || !nonConverted) return [];
  const f = baseFinding(input, "commercial_crm_mismatch", "Commercial/CRM mismatch", `Commercial status is "${s.commercial?.status}" but CRM stage is "${s.stage}".`);
  f.severity = stage(s) === "closed lost" || stage(s) === "closedlost" ? "critical" : "high";
  f.signals = [
    { signal: "commercial", value: s.commercial?.status ?? "" },
    { signal: "stage", value: s.stage ?? "" },
  ];
  return [setNeedsInvestigation(f)];
}

function trialBlockerFindings(input: ScanInput): Finding[] {
  const s = input.snapshot;
  if (stage(s) !== "trial" || s.blockers.length === 0) return [];
  const f = baseFinding(input, "trial_expiring_with_open_blocker", "Trial with open blocker", `Account is in Trial with ${s.blockers.length} open blocker(s).`);
  f.severity = "high";
  f.signals = [{ signal: "open_blockers", value: s.blockers.length }];
  f.evidence = s.blockers;
  return [setNeedsInvestigation(f)];
}

function customerWaitingFindings(input: ScanInput): Finding[] {
  const out: Finding[] = [];
  const now = input.now ?? new Date().toISOString();
  for (const c of input.snapshot.commitments) {
    if (c.type !== "internal" || c.status !== "open" || !c.dueDate) continue;
    const untilDue = msBetween(now, c.dueDate);
    if (untilDue < 0) continue; // overdue handled separately
    const days = wholeDays(untilDue);
    const f = baseFinding(input, "customer_waiting_on_us", `Customer waiting: ${c.description}`, `Customer is waiting on internal commitment "${c.description}".`);
    f.severity = days <= 1 ? "critical" : days <= 3 ? "high" : "medium";
    f.signals = [{ signal: "days_until_due", value: days }];
    out.push(setNeedsInvestigation(f));
  }
  return out;
}

function missingNextStepFindings(input: ScanInput): Finding[] {
  const s = input.snapshot;
  const openCommitments = s.commitments.filter((c) => c.status === "open" || c.status === "in_progress").length;
  const openQuestions = s.questions.filter((q) => q.status === "open").length;
  if ((openCommitments === 0 && openQuestions === 0) || s.nextSteps.length > 0) return [];
  const f = baseFinding(input, "missing_next_step", "Missing next step", `Account has ${openCommitments} open commitment(s) and ${openQuestions} open question(s) but no defined next step.`);
  f.severity = "medium";
  f.signals = [
    { signal: "open_commitments", value: openCommitments },
    { signal: "open_questions", value: openQuestions },
  ];
  return [f];
}

function gapFindings(input: ScanInput): Finding[] {
  const out: Finding[] = [];
  for (const g of input.snapshot.reconciliationGaps) {
    if (g.type === "duplicate") {
      const f = baseFinding(input, "duplicate_action", g.title, g.description || "Duplicate action detected by reconciliation.");
      f.severity = "medium";
      f.signals = [{ signal: "gap_what", value: g.what }];
      out.push(f);
    } else if (g.type === "contradictory") {
      const f = baseFinding(input, "contradictory_state", g.title, g.description || "Contradictory state detected by reconciliation.");
      f.severity = "high";
      f.signals = [{ signal: "gap_what", value: g.what }];
      out.push(setNeedsInvestigation(f));
    }
  }
  return out;
}

function missingContextFindings(input: ScanInput): Finding[] {
  const s = input.snapshot;
  if (s.unavailableSources.length === 0) return [];
  const f = baseFinding(input, "missing_required_context", "Missing required context", `Required source(s) unavailable: ${s.unavailableSources.join(", ")}.`);
  f.severity = s.unavailableSources.some((x) => x === "commercial" || x === "hubspot") ? "high" : "medium";
  f.signals = s.unavailableSources.map((x) => ({ signal: "unavailable_source", value: x }));
  return [setNeedsInvestigation(f)];
}

/** Produce the current set of findings for an account (pure, deterministic). */
export function scanAccount(input: ScanInput): Finding[] {
  return [
    ...overdueFindings(input),
    ...unansweredQuestionFindings(input),
    ...missingTaskFindings(input),
    ...staleCrmFindings(input),
    ...mismatchFindings(input),
    ...trialBlockerFindings(input),
    ...customerWaitingFindings(input),
    ...missingNextStepFindings(input),
    ...gapFindings(input),
    ...missingContextFindings(input),
  ];
}

/**
 * Reconcile the newly-scanned findings against existing persisted findings so the
 * lifecycle is: appear when condition true, persist while it remains, resolve when
 * evidence changes, and never duplicate on repeated scans.
 */
export function reconcileFindings(existing: Finding[], scanned: Finding[], now: string): Finding[] {
  const scannedKeys = new Set(scanned.map((f) => f.findingId));
  const byKey = new Map<string, Finding>();
  for (const f of existing) byKey.set(f.findingId, f);

  const result: Finding[] = [];
  for (const f of scanned) {
    const prev = byKey.get(f.findingId);
    if (prev && prev.status === "open") {
      // Persist while condition remains; refresh severity/description in place.
      result.push({ ...prev, ...f, createdAt: prev.createdAt, status: "open", resolvedAt: null });
    } else if (prev && prev.status === "resolved") {
      // Condition became true again after resolution: reopen with a fresh timestamp.
      result.push({ ...f, status: "open", createdAt: now, resolvedAt: null });
    } else {
      result.push(f);
    }
  }

  // Resolve findings whose condition is no longer present.
  for (const prev of existing) {
    if (prev.status === "open" && !scannedKeys.has(prev.findingId)) {
      result.push({ ...prev, status: "resolved", resolvedAt: now, updatedAt: now });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Persistence (Postgres). Pure logic above is unit-testable without a DB.
// ---------------------------------------------------------------------------

function rowToFinding(r: Record<string, unknown>): Finding {
  return {
    findingId: String(r.finding_id),
    userId: String(r.user_id),
    accountId: String(r.account_id),
    type: String(r.type) as FindingType,
    severity: String(r.severity) as Severity,
    title: String(r.title),
    description: (r.description as string) ?? "",
    evidence: (r.evidence as string[]) ?? [],
    sourceReferences: (r.source_references as string[]) ?? [],
    signals: (r.signals as { signal: string; value: string | number }[]) ?? [],
    needsInvestigation: Boolean(r.needs_investigation),
    status: String(r.status) as FindingStatus,
    createdAt: new Date(r.created_at as string).toISOString(),
    updatedAt: new Date(r.updated_at as string).toISOString(),
    resolvedAt: r.resolved_at ? new Date(r.resolved_at as string).toISOString() : null,
  };
}

export async function listFindings(userId: string, accountId: string): Promise<Finding[]> {
  const pool = getPool();
  const res = await pool.query(
    "SELECT * FROM risk_findings WHERE user_id = $1 AND account_id = $2 ORDER BY created_at DESC",
    [userId, accountId],
  );
  return (res.rows as Record<string, unknown>[]).map(rowToFinding);
}

export async function getFinding(userId: string, findingId: string): Promise<Finding | undefined> {
  const pool = getPool();
  const res = await pool.query("SELECT * FROM risk_findings WHERE user_id = $1 AND finding_id = $2", [userId, findingId]);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? rowToFinding(row) : undefined;
}

export async function persistFindings(userId: string, accountId: string, findings: Finding[]): Promise<void> {
  const pool = getPool();
  for (const f of findings) {
    await pool.query(
      `INSERT INTO risk_findings (finding_id, user_id, account_id, type, severity, title, description, evidence, source_references, signals, needs_investigation, status, created_at, updated_at, resolved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15)
       ON CONFLICT (finding_id) DO UPDATE SET
         severity = EXCLUDED.severity, title = EXCLUDED.title, description = EXCLUDED.description,
         evidence = EXCLUDED.evidence, source_references = EXCLUDED.source_references,
         signals = EXCLUDED.signals, needs_investigation = EXCLUDED.needs_investigation,
         status = EXCLUDED.status, updated_at = EXCLUDED.updated_at, resolved_at = EXCLUDED.resolved_at`,
      [
        f.findingId,
        userId,
        accountId,
        f.type,
        f.severity,
        f.title,
        f.description,
        JSON.stringify(f.evidence),
        JSON.stringify(f.sourceReferences),
        JSON.stringify(f.signals),
        f.needsInvestigation,
        f.status,
        f.createdAt,
        f.updatedAt,
        f.resolvedAt,
      ],
    );
  }
}

/**
 * Scan an account from its snapshot and persist the reconciled finding lifecycle.
 * Returns the current open findings. Wired into appendAccountEvent.
 */
export async function scanAndPersistAccount(userId: string, accountId: string, snapshot: AccountIntelligenceSnapshot, now?: string): Promise<Finding[]> {
  const time = now ?? new Date().toISOString();
  const scanned = scanAccount({ userId, accountId, snapshot, now: time });
  const existing = await listFindings(userId, accountId);
  const reconciled = reconcileFindings(existing, scanned, time);
  await persistFindings(userId, accountId, reconciled);
  return reconciled.filter((f) => f.status === "open");
}
