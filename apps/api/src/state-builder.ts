import type {
  AuthorityLevel,
  Commitment,
  ConditionalCommitment,
  Decision,
  ResolutionState,
  SourceType,
  TemporalExpression,
} from "./core.js";

/**
 * STEP 52 — Account Intelligence State Builder.
 *
 * This is the deterministic reducer that turns a sequence of normalized
 * AccountEvents into the latest structured AccountIntelligenceSnapshot.
 *
 * Design invariants:
 *   - Pure: no I/O, no LLM. Every input fact is already persisted in the event
 *     payload (semantic outputs are stored verbatim), so a rebuild never
 *     re-calls the LLM.
 *   - Append-only: history is never erased; "latest" single-value facts are
 *     last-writer-wins among their own authoritative source, while the event
 *     ledger keeps every prior value.
 *   - Source-authoritative: each fact-type has exactly one authoritative source;
 *     a weaker source can never overwrite a stronger one (see FACT_AUTHORITY
 *     rules below). Conflict between authoritative sources is surfaced as
 *     "ambiguous", never silently resolved.
 *   - Tenant-scoped: state is per (user_id, account_id); nothing here merges
 *     across users.
 */

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

export type CommitmentStatus = "open" | "fulfilled" | "superseded" | "ambiguous";

export interface CommitmentState {
  id: string;
  action: string;
  owner: string | null;
  ownerResolution: ResolutionState | null;
  deadlineText: string | null;
  deadlineValue: string | null;
  status: CommitmentStatus;
  source: SourceType;
  sourceReference: string | null;
  linkedTaskId: string | null;
  /** Set when a source (Gmail/HubSpot) later proves the promised work was done. */
  fulfillment: { source: SourceType; reference: string | null; occurredAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

export type QuestionStatus = "open" | "answered" | "ambiguous";

export interface QuestionState {
  id: string;
  question: string;
  status: QuestionStatus;
  answer: { text: string; source: SourceType; reference: string | null; occurredAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionState {
  id: string;
  text: string;
  decidedBy: string | null;
  source: SourceType;
  sourceReference: string | null;
  occurredAt: string;
}

export interface AccountIntelligenceSnapshot {
  identity: { companyId?: string; contactId?: string; dealId?: string; name?: string } | null;
  /** CRM stage (HubSpot). Authoritative source: hubspot. Never overwritten by conversation. */
  stage: string | null;
  stageSource: SourceType | null;
  /** Subscription/payment/commercial truth. Authoritative source: commercial. */
  commercial: { status?: string; provenance?: string | null } | null;
  decisions: DecisionState[];
  /** Full commitment history; open ones are those with status === "open". */
  commitments: CommitmentState[];
  questions: QuestionState[];
  blockers: string[];
  nextSteps: string[];
  risks: string[];
  recentEvents: { eventType: AccountEventType; occurredAt: string }[];
  executionGaps: string[];
  /** Sources that failed to load on the most recent refresh (facts must not be guessed). */
  unavailableSources: SourceType[];
  lastReviewed: string | null;
  lastSourceRefresh: string | null;
  version: number;
}

export const EMPTY_SNAPSHOT: AccountIntelligenceSnapshot = {
  identity: null,
  stage: null,
  stageSource: null,
  commercial: null,
  decisions: [],
  commitments: [],
  questions: [],
  blockers: [],
  nextSteps: [],
  risks: [],
  recentEvents: [],
  executionGaps: [],
  unavailableSources: [],
  lastReviewed: null,
  lastSourceRefresh: null,
  version: 0,
};

/**
 * The payload shape the state builder reads out of an interaction/meeting event.
 * Semantic outputs are persisted verbatim by the ingestion layer; the builder
 * only reads what is already there (no re-extraction).
 */
export interface SemanticPayload {
  confirmedCommitments?: Commitment[];
  candidateCommitments?: Commitment[];
  conditionalCommitments?: ConditionalCommitment[];
  decisions?: Decision[];
  blockers?: string[];
  /** Explicit customer questions. Populated by semantic extraction/manual input. */
  questions?: { id?: string; text: string; resolution?: ResolutionState }[];
  /** Answers that resolve a prior open question. */
  answers?: { questionId?: string; questionText?: string; text: string }[];
  /** Owner resolutions that disambiguate a previously-ambiguous commitment. */
  ownerResolutions?: { commitmentId?: string; action?: string; owner: string | null }[];
}

/**
 * Source-authority hierarchy (subset of the canonical FACT_AUTHORITY table).
 *
 *   commercial  > conversation  for subscription/payment truth
 *   conversation > CRM metadata  for what the customer literally promised/asked
 *   tasks/hubspot > transcript    for whether an operational task exists
 *
 * A fact is written to its own single field (stage vs commercial), so a weaker
 * source never overwrites a stronger one structurally. Within a fact-type, newer
 * authoritative evidence supersedes the older "latest" value; the older value
 * remains in the ledger.
 */
const AUTHORITY_RANK: Record<SourceType, number> = {
  commercial: 3,
  hubspot: 3,
  tasks: 3,
  gmail: 2,
  conversation: 1,
  system: 0,
};

function rank(source: SourceType | null | undefined): number {
  if (!source) return 0;
  return AUTHORITY_RANK[source] ?? 0;
}

function norm(text: string | null | undefined): string {
  return (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function stableId(prefix: string, key: string): string {
  // Deterministic id from content, so rebuilds are reproducible.
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return `${prefix}_${(h >>> 0).toString(36)}`;
}

function commitmentKey(action: string, owner: string | null | undefined): string {
  return `${norm(action)}|${norm(owner)}`;
}

function questionKey(text: string): string {
  return norm(text);
}

function union<T>(a: T[], b: T | T[] | undefined): T[] {
  const add = Array.isArray(b) ? b : b ? [b] : [];
  const out = new Set(a);
  for (const v of add) out.add(v);
  return [...out];
}

function timestampOf(event: AccountEvent): string {
  return event.occurredAt;
}

/**
 * Promote a semantic commitment into an open CommitmentState, without ever
 * inferring an owner from vague "we"/"our team" language. Tentative language is
 * never promoted here — only `confirmedCommitments` become open commitments
 * (candidate/conditional commitments are intentionally ignored by the builder).
 */
function ingestCommitments(snapshot: AccountIntelligenceSnapshot, commitments: Commitment[] | undefined, source: SourceType | null, event: AccountEvent): void {
  for (const c of commitments ?? []) {
    const owner = c.owner?.trim() ? c.owner : null;
    const ownerResolution: ResolutionState | null = owner ? "resolved" : c.resolution ?? "missing_context";
    const deadline = deadlineOf(c.deadline);
    const key = commitmentKey(c.action, owner);

    const existing = snapshot.commitments.find((x) => commitmentKey(x.action, x.owner) === key);
    if (existing) {
      // Equivalent commitment already tracked: link, do not duplicate.
      if (deadline?.value && !existing.deadlineValue) {
        existing.deadlineValue = deadline.value;
        existing.deadlineText = deadline.text;
      }
      existing.updatedAt = timestampOf(event);
      continue;
    }

    snapshot.commitments.push({
      id: c.id ?? stableId("cmt", key),
      action: c.action,
      owner,
      ownerResolution,
      deadlineText: deadline?.text ?? null,
      deadlineValue: deadline?.value ?? null,
      status: ownerResolution === "ambiguous" || ownerResolution === "conflicting" ? "ambiguous" : "open",
      source: source ?? "conversation",
      sourceReference: event.sourceReference,
      linkedTaskId: null,
      fulfillment: null,
      createdAt: timestampOf(event),
      updatedAt: timestampOf(event),
    });
  }
}

function deadlineOf(d: TemporalExpression | null | undefined): { text: string; value: string | null } | null {
  if (!d) return null;
  // Only deterministically-resolvable dates carry a value; ambiguous/conditional
  // deadlines keep their text but never a coerced value.
  return { text: d.text, value: d.value ?? null };
}

function ingestQuestions(snapshot: AccountIntelligenceSnapshot, questions: SemanticPayload["questions"], source: SourceType | null, event: AccountEvent): void {
  for (const q of questions ?? []) {
    const text = q.text?.trim();
    if (!text) continue;
    const key = questionKey(text);
    if (snapshot.questions.some((x) => questionKey(x.question) === key)) continue;
    const resolution = q.resolution ?? "resolved";
    snapshot.questions.push({
      id: q.id ?? stableId("q", key),
      question: text,
      status: resolution === "ambiguous" || resolution === "conflicting" ? "ambiguous" : "open",
      answer: null,
      createdAt: timestampOf(event),
      updatedAt: timestampOf(event),
    });
  }
}

function ingestDecisions(snapshot: AccountIntelligenceSnapshot, decisions: Decision[] | undefined, source: SourceType | null, event: AccountEvent): void {
  for (const d of decisions ?? []) {
    const key = norm(d.text);
    if (snapshot.decisions.some((x) => norm(x.text) === key)) continue;
    snapshot.decisions.push({
      id: d.id ?? stableId("dec", key),
      text: d.text,
      decidedBy: d.decidedBy?.trim() ? d.decidedBy : null,
      source: source ?? "conversation",
      sourceReference: event.sourceReference,
      occurredAt: timestampOf(event),
    });
  }
}

function ingestAnswers(snapshot: AccountIntelligenceSnapshot, answers: SemanticPayload["answers"], source: SourceType | null, event: AccountEvent): void {
  for (const a of answers ?? []) {
    if (!a.text?.trim()) continue;
    const q = snapshot.questions.find(
      (x) => (a.questionId && x.id === a.questionId) || (a.questionText && questionKey(x.question) === questionKey(a.questionText)),
    );
    if (!q) continue;
    // Only a non-empty answer resolves a question; weak/unavailable evidence
    // leaves it open (never fabricates an answer).
    q.status = "answered";
    q.answer = { text: a.text, source: source ?? "conversation", reference: event.sourceReference, occurredAt: timestampOf(event) };
    q.updatedAt = timestampOf(event);
  }
}

function ingestOwnerResolutions(snapshot: AccountIntelligenceSnapshot, resolutions: SemanticPayload["ownerResolutions"], event: AccountEvent): void {
  for (const r of resolutions ?? []) {
    const c = snapshot.commitments.find(
      (x) => (r.commitmentId && x.id === r.commitmentId) || (r.action && norm(x.action) === norm(r.action)),
    );
    if (!c) continue;
    if (r.owner?.trim()) {
      c.owner = r.owner;
      c.ownerResolution = "resolved";
      if (c.status === "ambiguous") c.status = "open";
      c.updatedAt = timestampOf(event);
    }
  }
}

function linkCommitmentToTask(snapshot: AccountIntelligenceSnapshot, p: Record<string, unknown>): void {
  const taskId = typeof p.taskId === "string" ? p.taskId : null;
  const commitmentId = typeof p.commitmentId === "string" ? p.commitmentId : null;
  const action = typeof p.action === "string" ? p.action : null;
  if (!taskId) return;
  const c = snapshot.commitments.find(
    (x) => (commitmentId && x.id === commitmentId) || (action && norm(x.action) === norm(action)),
  );
  if (c && !c.linkedTaskId) c.linkedTaskId = taskId;
}

function fulfillCommitmentByTask(snapshot: AccountIntelligenceSnapshot, p: Record<string, unknown>, event: AccountEvent): void {
  const taskId = typeof p.taskId === "string" ? p.taskId : null;
  if (!taskId) return;
  for (const c of snapshot.commitments) {
    if (c.linkedTaskId === taskId && c.status === "open") {
      c.status = "fulfilled";
      c.fulfillment = { source: "tasks", reference: taskId, occurredAt: timestampOf(event) };
      c.updatedAt = timestampOf(event);
    }
  }
}

function applyFulfillmentEvidence(snapshot: AccountIntelligenceSnapshot, p: Record<string, unknown>, event: AccountEvent): void {
  // Gmail proves a promised document/communication was delivered.
  const reference = typeof p.reference === "string" ? p.reference : event.sourceReference;
  const commitmentId = typeof p.commitmentId === "string" ? p.commitmentId : null;
  const action = typeof p.action === "string" ? p.action : null;
  const delivered = p.delivered !== false; // evidence of delivery
  if (!delivered) return;
  const c = snapshot.commitments.find(
    (x) => (commitmentId && x.id === commitmentId) || (action && norm(x.action) === norm(action)),
  );
  if (c && c.status === "open") {
    c.status = "fulfilled";
    c.fulfillment = { source: "gmail", reference, occurredAt: timestampOf(event) };
    c.updatedAt = timestampOf(event);
  }
}

/**
 * Fold one event into a snapshot. Pure and deterministic.
 */
export function reduceEvent(snapshot: AccountIntelligenceSnapshot, event: AccountEvent): AccountIntelligenceSnapshot {
  const next: AccountIntelligenceSnapshot = {
    ...snapshot,
    identity: snapshot.identity,
    decisions: snapshot.decisions,
    commitments: snapshot.commitments,
    questions: snapshot.questions,
    blockers: [...snapshot.blockers],
    nextSteps: [...snapshot.nextSteps],
    risks: [...snapshot.risks],
    executionGaps: [...snapshot.executionGaps],
    unavailableSources: [...snapshot.unavailableSources],
    version: snapshot.version + 1,
  };
  next.recentEvents = [{ eventType: event.eventType, occurredAt: event.occurredAt }, ...snapshot.recentEvents].slice(0, 50);

  const p = event.payload ?? {};
  const source = (event.source as SourceType | null) ?? "system";
  const occurredAt = timestampOf(event);

  // Provider unavailability: record it and refuse to guess dependent facts.
  if (Array.isArray(p.unavailableSources)) {
    next.unavailableSources = union(next.unavailableSources, p.unavailableSources as SourceType[]);
  }

  switch (event.eventType) {
    case "crm_state_observed":
      if (p.unavailable === true) {
        next.unavailableSources = union(next.unavailableSources, "hubspot");
      } else if (typeof p.stage === "string") {
        next.stage = p.stage;
        next.stageSource = "hubspot";
        next.lastSourceRefresh = occurredAt;
      }
      if (p.identity && typeof p.identity === "object") {
        next.identity = { ...(p.identity as AccountIntelligenceSnapshot["identity"]) };
      }
      break;

    case "commercial_state_observed":
      if (p.unavailable === true) {
        next.unavailableSources = union(next.unavailableSources, "commercial");
      } else if (typeof p.status === "string") {
        // Commercial truth is authoritative; only this event type may write it.
        next.commercial = { status: p.status, provenance: (event.provenance ?? (p.provenance as string) ?? null) };
        next.lastSourceRefresh = occurredAt;
      }
      break;

    case "manual_interaction_processed":
    case "interaction_processed":
    case "meeting_processed": {
      const semantic = (p.semantic ?? {}) as SemanticPayload;
      ingestCommitments(next, semantic.confirmedCommitments, source, event);
      ingestQuestions(next, semantic.questions, source, event);
      ingestDecisions(next, semantic.decisions, source, event);
      next.blockers = union(next.blockers, semantic.blockers);
      ingestAnswers(next, semantic.answers, source, event);
      ingestOwnerResolutions(next, semantic.ownerResolutions, event);
      // Conversational commercial intent is EVIDENCE, never overwrites authoritative
      // `commercial` state. It is intentionally not applied here.
      break;
    }

    case "task_created":
      linkCommitmentToTask(next, p);
      break;

    case "task_completed":
      fulfillCommitmentByTask(next, p, event);
      break;

    case "email_observed":
      applyFulfillmentEvidence(next, p, event);
      break;

    case "external_action_executed":
      if (typeof p.actionType === "string") {
        if (p.status === "failed") {
          next.executionGaps = union(next.executionGaps, `${p.actionType}:${(p.target as string) ?? ""}`);
        } else if (typeof p.actionType === "string") {
          next.nextSteps = union(next.nextSteps, `executed:${p.actionType}`);
        }
      }
      break;

    case "proposal_approved":
    case "proposal_rejected":
    case "manual_correction":
      next.lastReviewed = occurredAt;
      if (event.eventType === "manual_correction") {
        // Manual correction is authoritative human override (system source).
        if (typeof p.stage === "string") next.stage = p.stage;
        if (typeof p.status === "string") next.commercial = { status: p.status, provenance: event.provenance ?? "manual_correction" };
        if (p.ownerResolutions) ingestOwnerResolutions(next, p.ownerResolutions as SemanticPayload["ownerResolutions"], event);
        if (p.risks) next.risks = union(next.risks, p.risks as string[]);
      }
      break;
  }

  return next;
}

/**
 * Rebuild the snapshot deterministically from an ordered (or unordered) event
 * history. Events are sorted ascending by `occurredAt` (stable tie-break by
 * eventId) and de-duplicated by eventId, so duplicate and out-of-order inputs
 * fold to the same state.
 *
 * `prior` is optional: when provided, the fold starts from it (used to warm the
 * reducer from a cached snapshot), otherwise from EMPTY_SNAPSHOT.
 */
export function buildState(events: AccountEvent[], prior: AccountIntelligenceSnapshot = EMPTY_SNAPSHOT): AccountIntelligenceSnapshot {
  const seen = new Set<string>();
  const ordered = events
    .filter((e) => {
      if (seen.has(e.eventId)) return false;
      seen.add(e.eventId);
      return true;
    })
    .slice()
    .sort((a, b) => {
      const ta = Date.parse(a.occurredAt) || 0;
      const tb = Date.parse(b.occurredAt) || 0;
      if (ta !== tb) return ta - tb;
      return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
    });

  let state: AccountIntelligenceSnapshot = {
    ...EMPTY_SNAPSHOT,
    ...prior,
    decisions: [...(prior.decisions ?? [])],
    commitments: [...(prior.commitments ?? [])],
    questions: [...(prior.questions ?? [])],
    blockers: [...(prior.blockers ?? [])],
    nextSteps: [...(prior.nextSteps ?? [])],
    risks: [...(prior.risks ?? [])],
    executionGaps: [...(prior.executionGaps ?? [])],
    unavailableSources: [...(prior.unavailableSources ?? [])],
    recentEvents: [...(prior.recentEvents ?? [])],
  };

  for (const event of ordered) {
    state = reduceEvent(state, event);
  }
  return state;
}
