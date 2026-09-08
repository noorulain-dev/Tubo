import { getPool } from "./db.js";
import type { AccountIntelligenceSnapshot } from "./state-builder.js";
import type { Finding, FindingType, Severity } from "./risk-scanner.js";
import { listFindings } from "./risk-scanner.js";
import { listPlans } from "./execution-plans.js";
import { listAccountEvents, getSnapshot } from "./account-intelligence.js";

/**
 * STEP 57 — Revenue Command Center (backend/API only).
 *
 * Answers "What needs my attention?" for an authenticated user by aggregating
 * PERSISTED state (account intelligence, scanner findings, investigations, plans,
 * events) — no N+1 provider calls during page load. Priority is deterministic
 * (severity + recency), never an opaque LLM score.
 */

export interface TopFinding {
  type: FindingType;
  title: string;
  severity: Severity;
}

export interface AccountRow {
  accountId: string;
  identity: { name?: string; companyId?: string; contactId?: string; dealId?: string } | null;
  stage: string | null;
  commercial: string | null;
  highestSeverity: Severity | null;
  topFinding: TopFinding | null;
  openCommitments: number;
  openQuestions: number;
  blockerCount: number;
  blocked: boolean;
  lastMeaningfulEventAt: string | null;
  pendingCount: number;
  lastReviewedAt: string | null;
  updatedAt: string | null;
  /** True for [ASSESSMENT]-tagged synthetic records (shown as "Test data" in the UI). */
  isAssessment: boolean;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function severityRank(s: Severity | null): number {
  return s ? SEVERITY_RANK[s] : 0;
}

/**
 * Deterministic priority: highest severity first, then recency, then open-item
 * volume. No LLM score.
 */
export function priorityScore(row: AccountRow): number {
  const sev = severityRank(row.highestSeverity) * 1e15;
  const recency = Date.parse(row.lastMeaningfulEventAt ?? "0") || 0;
  const volume = row.openCommitments + row.openQuestions + row.blockerCount;
  return sev + recency + volume;
}

export function sortAccounts(rows: AccountRow[]): AccountRow[] {
  return [...rows].sort((a, b) => priorityScore(b) - priorityScore(a));
}

export function paginate<T>(rows: T[], limit: number, offset: number): T[] {
  const l = Math.max(0, Math.floor(limit));
  const o = Math.max(0, Math.floor(offset));
  return rows.slice(o, o + l);
}

const OPEN_COMMITMENT = new Set(["open", "in_progress", "overdue"]);

export function aggregateAccount(accountId: string, snapshot: AccountIntelligenceSnapshot, openFindings: Finding[], reviewedAt: string | null): AccountRow {
  const commitments = snapshot.commitments ?? [];
  const questions = snapshot.questions ?? [];
  const openCommitments = commitments.filter((c) => OPEN_COMMITMENT.has(c.status)).length;
  const openQuestions = questions.filter((q) => q.status === "open").length;

  const top = [...openFindings].sort((a, b) => {
    const d = severityRank(b.severity) - severityRank(a.severity);
    if (d !== 0) return d;
    return (b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0);
  })[0];

  const lastEvent = snapshot.recentEvents?.[0]?.occurredAt ?? null;

  return {
    accountId,
    identity: snapshot.identity ?? null,
    stage: snapshot.stage,
    commercial: snapshot.commercial?.status ?? null,
    highestSeverity: top?.severity ?? null,
    topFinding: top ? { type: top.type, title: top.title, severity: top.severity } : null,
    openCommitments,
    openQuestions,
    blockerCount: snapshot.blockers?.length ?? 0,
    blocked: (snapshot.blockers?.length ?? 0) > 0,
    lastMeaningfulEventAt: lastEvent,
    pendingCount: openFindings.length,
    lastReviewedAt: reviewedAt,
    updatedAt: null,
    isAssessment: accountId.startsWith("[ASSESSMENT]") || (snapshot.identity?.name?.includes("[ASSESSMENT]") ?? false),
  };
}

export interface ChangeSet {
  stage: { before: string | null; after: string | null } | null;
  commercial: { before: string | null; after: string | null } | null;
  newCommitments: string[];
  resolvedCommitments: string[];
  newQuestions: string[];
  answeredQuestions: string[];
  newBlockers: string[];
  resolvedBlockers: string[];
  eventsSince: number;
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Deterministic structured diff between the current snapshot and the snapshot
 * captured at the last review. The AI may summarize this, but the change set
 * itself is computed deterministically.
 */
export function computeChanges(current: AccountIntelligenceSnapshot, reviewed: AccountIntelligenceSnapshot | null): ChangeSet {
  if (!reviewed) {
    return {
      stage: null,
      commercial: null,
      newCommitments: (current.commitments ?? []).map((c) => c.description),
      resolvedCommitments: [],
      newQuestions: (current.questions ?? []).map((q) => q.question),
      answeredQuestions: [],
      newBlockers: [...(current.blockers ?? [])],
      resolvedBlockers: [],
      eventsSince: current.version,
    };
  }

  const curCommitments = new Set((current.commitments ?? []).map((c) => norm(c.description)));
  const revCommitments = new Set((reviewed.commitments ?? []).map((c) => norm(c.description)));
  const newCommitments = (current.commitments ?? []).filter((c) => !revCommitments.has(norm(c.description))).map((c) => c.description);
  const resolvedCommitments = (reviewed.commitments ?? [])
    .filter((c) => OPEN_COMMITMENT.has(c.status))
    .filter((c) => {
      const now = (current.commitments ?? []).find((x) => norm(x.description) === norm(c.description));
      return !now || !OPEN_COMMITMENT.has(now.status);
    })
    .map((c) => c.description);

  const curQ = new Set((current.questions ?? []).map((q) => norm(q.question)));
  const revQ = new Set((reviewed.questions ?? []).map((q) => norm(q.question)));
  const newQuestions = (current.questions ?? []).filter((q) => !revQ.has(norm(q.question))).map((q) => q.question);
  const answeredQuestions = (current.questions ?? []).filter((q) => q.status === "answered" && !revQ.has(norm(q.question)) === false).filter((q) => {
    const prev = (reviewed.questions ?? []).find((x) => norm(x.question) === norm(q.question));
    return prev && prev.status !== "answered" && q.status === "answered";
  }).map((q) => q.question);

  const curB = new Set(current.blockers ?? []);
  const revB = new Set(reviewed.blockers ?? []);
  const newBlockers = (current.blockers ?? []).filter((b) => !revB.has(b));
  const resolvedBlockers = (reviewed.blockers ?? []).filter((b) => !curB.has(b));

  return {
    stage: current.stage !== reviewed.stage ? { before: reviewed.stage, after: current.stage } : null,
    commercial: (current.commercial?.status ?? null) !== (reviewed.commercial?.status ?? null)
      ? { before: reviewed.commercial?.status ?? null, after: current.commercial?.status ?? null }
      : null,
    newCommitments,
    resolvedCommitments,
    newQuestions,
    answeredQuestions,
    newBlockers,
    resolvedBlockers,
    eventsSince: Math.max(0, current.version - reviewed.version),
  };
}

export interface AccountDetail {
  accountId: string;
  snapshot: AccountIntelligenceSnapshot;
  changes: ChangeSet;
  findings: Finding[];
  latestInvestigation: unknown | null;
  plans: unknown[];
  recentEvents: unknown[];
  lastReviewedAt: string | null;
}

// ---------------------------------------------------------------------------
// Persistence + aggregation (reads come from DB, no N+1 provider calls)
// ---------------------------------------------------------------------------

interface ReviewRow {
  reviewed_at: string;
  snapshot: AccountIntelligenceSnapshot;
}

async function listReviewStates(userId: string): Promise<Map<string, ReviewRow>> {
  const pool = getPool();
  const res = await pool.query("SELECT account_id, reviewed_at, snapshot FROM review_state WHERE user_id = $1", [userId]);
  const map = new Map<string, ReviewRow>();
  for (const r of res.rows as { account_id: string; reviewed_at: string; snapshot: AccountIntelligenceSnapshot }[]) {
    map.set(r.account_id, { reviewed_at: new Date(r.reviewed_at).toISOString(), snapshot: r.snapshot });
  }
  return map;
}

export async function listAccountRows(userId: string, opts: { limit?: number; offset?: number } = {}): Promise<{ rows: AccountRow[]; total: number }> {
  const pool = getPool();
  const snapRes = await pool.query("SELECT account_id, state, updated_at FROM account_intelligence WHERE user_id = $1", [userId]);
  const snapshots = new Map<string, { state: AccountIntelligenceSnapshot; updatedAt: string }>();
  for (const r of snapRes.rows as { account_id: string; state: AccountIntelligenceSnapshot; updated_at: string }[]) {
    snapshots.set(r.account_id, { state: r.state, updatedAt: new Date(r.updated_at).toISOString() });
  }

  const findRes = await pool.query("SELECT * FROM risk_findings WHERE user_id = $1 AND status = 'open'", [userId]);
  const findingsByAccount = new Map<string, Finding[]>();
  for (const r of findRes.rows as Record<string, unknown>[]) {
    const f = rowToFinding(r);
    const list = findingsByAccount.get(f.accountId) ?? [];
    list.push(f);
    findingsByAccount.set(f.accountId, list);
  }

  const reviews = await listReviewStates(userId);

  const rows: AccountRow[] = [];
  for (const [accountId, { state, updatedAt }] of snapshots) {
    const row = aggregateAccount(accountId, state, findingsByAccount.get(accountId) ?? [], reviews.get(accountId)?.reviewed_at ?? null);
    row.updatedAt = updatedAt;
    rows.push(row);
  }

  const sorted = sortAccounts(rows);
  const total = sorted.length;
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  return { rows: paginate(sorted, limit, offset), total };
}

export async function getAccountDetail(userId: string, accountId: string): Promise<AccountDetail | undefined> {
  const snapshot = await getSnapshot(userId, accountId);
  const reviews = await listReviewStates(userId);
  const reviewed = reviews.get(accountId);

  const findings = await listFindings(userId, accountId);

  const pool = getPool();
  const invRes = await pool.query(
    `SELECT fi.finding_id, fi.outcome, fi.trace, fi.started_at, fi.finished_at
       FROM finding_investigations fi
       JOIN risk_findings rf ON rf.finding_id = fi.finding_id AND rf.user_id = fi.user_id
      WHERE fi.user_id = $1 AND rf.account_id = $2
      ORDER BY fi.id DESC LIMIT 1`,
    [userId, accountId],
  );
  const latestInvestigation = invRes.rows[0] ?? null;

  const plans = await listPlans(userId, accountId);
  const events = await listAccountEvents(userId, accountId);

  return {
    accountId,
    snapshot,
    changes: computeChanges(snapshot, reviewed?.snapshot ?? null),
    findings,
    latestInvestigation,
    plans,
    recentEvents: events,
    lastReviewedAt: reviewed?.reviewed_at ?? null,
  };
}

export async function markReviewed(userId: string, accountId: string): Promise<{ reviewedAt: string; version: number }> {
  const snapshot = await getSnapshot(userId, accountId);
  const pool = getPool();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO review_state (user_id, account_id, reviewed_at, snapshot)
     VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (user_id, account_id) DO UPDATE SET reviewed_at = EXCLUDED.reviewed_at, snapshot = EXCLUDED.snapshot`,
    [userId, accountId, now, JSON.stringify(snapshot)],
  );
  return { reviewedAt: now, version: snapshot.version };
}

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
    status: String(r.status) as "open" | "resolved",
    createdAt: new Date(r.created_at as string).toISOString(),
    updatedAt: new Date(r.updated_at as string).toISOString(),
    resolvedAt: r.resolved_at ? new Date(r.resolved_at as string).toISOString() : null,
  };
}
