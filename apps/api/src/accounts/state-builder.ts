import type {
  Commitment,
  ConditionalCommitment,
  Decision,
  ResolutionState,
  SourceType,
  TemporalExpression,
} from "../shared/core.js";

/**
 * STEP 52/53 — Account Intelligence State Builder + bounded commitment lifecycle
 * and customer-question state.
 *
 * Deterministic reducer: ordered AccountEvents -> AccountIntelligenceSnapshot.
 * No I/O, no LLM. Every input fact is already persisted in the event payload, so
 * a rebuild never re-calls the LLM. Source authority is explicit and structural:
 * a weaker source can never overwrite a stronger one.
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

export type CommitmentStatus =
  | "open"
  | "in_progress"
  | "fulfilled"
  | "overdue"
  | "blocked"
  | "cancelled"
  | "superseded"
  | "ambiguous";

export type CommitmentType = "internal" | "customer";

export interface EvidenceRef {
  source: SourceType;
  reference: string | null;
}

/**
 * Where a single field's value came from. `human_supplied` is only ever set by
 * an explicit operator resolution — it never overwrites `sourceEvidence`, which
 * remains the untouched record of what the original conversation actually said.
 */
export type FieldProvenance = "ai_inferred" | "system_retrieved" | "human_supplied";

export interface CommitmentState {
  id: string;
  accountId: string | null;
  type: CommitmentType;
  description: string;
  owner: string | null;
  ownerResolution: ResolutionState | null;
  /** Set when a human resolved the owner; absent means the model/source inferred it. */
  ownerProvenance?: FieldProvenance;
  ownerResolvedBy?: string | null;
  ownerResolvedAt?: string | null;
  dueDate: string | null;
  dueDateText: string | null;
  dueDateResolution: ResolutionState | null;
  dueDateProvenance?: FieldProvenance;
  dueDateResolvedBy?: string | null;
  dueDateResolvedAt?: string | null;
  /** A human explicitly recorded that there is no deadline. Not a fabricated date. */
  dueDateWaived?: boolean;
  condition: string | null;
  status: CommitmentStatus;
  sourceEvidence: EvidenceRef[];
  relatedTaskIds: string[];
  relatedEmailIds: string[];
  fulfillment: EvidenceRef & { occurredAt: string } | null;
  createdAt: string;
  updatedAt: string;
}


export type QuestionStatus = "open" | "answered" | "ambiguous" | "obsolete";

export interface QuestionState {
  id: string;
  question: string;
  sourceEvidence: EvidenceRef[];
  askedAt: string;
  answer: { text: string; source: SourceType; reference: string | null } | null;
  answeredAt: string | null;
  status: QuestionStatus;
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
  stage: string | null;
  stageSource: SourceType | null;
  commercial: { status?: string; provenance?: string | null } | null;
  decisions: DecisionState[];
  commitments: CommitmentState[];
  questions: QuestionState[];
  blockers: string[];
  nextSteps: string[];
  risks: string[];
  recentEvents: { eventType: AccountEventType; occurredAt: string }[];
  executionGaps: string[];
  /** Compact summary of Step-50 reconciliation/execution gaps (reused, not re-derived). */
  reconciliationGaps: ReconciliationGapRef[];
  unavailableSources: SourceType[];
  lastReviewed: string | null;
  lastSourceRefresh: string | null;
  version: number;
}

export interface ReconciliationGapRef {
  type: string;
  what: string;
  title: string;
  description: string;
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
  reconciliationGaps: [],
  unavailableSources: [],
  lastReviewed: null,
  lastSourceRefresh: null,
  version: 0,
};

/**
 * Payload shape the state builder reads from interaction/meeting/email events.
 * Semantic outputs are persisted verbatim; the builder only reads what is there.
 */
export interface SemanticPayload {
  confirmedCommitments?: Commitment[];
  candidateCommitments?: Commitment[];
  conditionalCommitments?: ConditionalCommitment[];
  decisions?: Decision[];
  blockers?: string[];
  /** Curated customer questions (semantic layer already excludes rhetorical/social). */
  questions?: { id?: string; text: string; resolution?: ResolutionState }[];
  answers?: { questionId?: string; questionText?: string; text: string }[];
  ownerResolutions?: { commitmentId?: string; description?: string; owner: string | null }[];
}

/**
 * Source-authority hierarchy:
 *   commercial > conversation   for subscription/payment truth
 *   conversation > CRM metadata for what the customer literally promised/asked
 *   tasks/hubspot > transcript    for whether an operational task exists
 * Facts are written to their own single field (stage vs commercial), so a weaker
 * source never overwrites a stronger one structurally.
 */
const AUTHORITY_RANK: Record<SourceType, number> = {
  commercial: 3,
  hubspot: 3,
  tasks: 3,
  gmail: 2,
  conversation: 1,
  system: 0,
};

function norm(text: string | null | undefined): string {
  return (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function stableId(prefix: string, key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return `${prefix}_${(h >>> 0).toString(36)}`;
}

function commitmentKey(description: string, owner: string | null | undefined): string {
  return `${norm(description)}|${norm(owner)}`;
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

/** Deadline -> dueDate. Only deterministically-resolvable dates carry a value. */
function deadlineOf(d: TemporalExpression | null | undefined): { value: string | null; text: string | null; resolution: ResolutionState } {
  if (!d) return { value: null, text: null, resolution: "missing_context" };
  if (d.value) return { value: d.value, text: d.text, resolution: "resolved" };
  if (d.kind === "ambiguous" || d.resolution === "ambiguous" || d.resolution === "conflicting") {
    return { value: null, text: d.text, resolution: "ambiguous" };
  }
  if (d.kind === "conditional") return { value: null, text: d.text, resolution: "ambiguous" };
  // Relative/unsupported without a resolved value: never coerce.
  return { value: null, text: d.text, resolution: "ambiguous" };
}

/**
 * Promote a semantic commitment into a CommitmentState. Tentative "candidate"
 * commitments ("we should…") are NEVER promoted. Conditional commitments are
 * tracked with their `condition` captured. Owner is never inferred from vague
 * "we"/"our team".
 */
function ingestCommitments(snapshot: AccountIntelligenceSnapshot, commitments: Commitment[] | undefined, source: SourceType, event: AccountEvent): void {
  for (const c of commitments ?? []) {
    const owner = c.owner?.trim() ? c.owner : null;
    const ownerResolution: ResolutionState = owner ? "resolved" : (c.resolution as ResolutionState) ?? "missing_context";
    const due = deadlineOf(c.deadline);
    const key = commitmentKey(c.action, owner);

    const existing = snapshot.commitments.find((x) => commitmentKey(x.description, x.owner) === key);
    if (existing) {
      if (due.value && !existing.dueDate) {
        existing.dueDate = due.value;
        existing.dueDateText = due.text;
        existing.dueDateResolution = due.resolution;
      }
      existing.updatedAt = event.occurredAt;
      existing.sourceEvidence = union(existing.sourceEvidence, [{ source, reference: event.sourceReference }]);
      continue;
    }

    const ambiguousOwner = ownerResolution === "ambiguous" || ownerResolution === "conflicting";
    const ambiguousDate = due.resolution === "ambiguous";
    snapshot.commitments.push({
      id: c.id ?? stableId("cmt", key),
      accountId: event.accountId,
      type: "internal",
      description: c.action,
      owner,
      ownerResolution,
      dueDate: due.value,
      dueDateText: due.text,
      dueDateResolution: due.resolution,
      condition: null,
      status: ambiguousOwner || ambiguousDate ? "ambiguous" : "open",
      sourceEvidence: [{ source, reference: event.sourceReference }],
      relatedTaskIds: [],
      relatedEmailIds: [],
      fulfillment: null,
      createdAt: event.occurredAt,
      updatedAt: event.occurredAt,
    });
  }
}

function ingestConditionalCommitments(snapshot: AccountIntelligenceSnapshot, commitments: ConditionalCommitment[] | undefined, source: SourceType, event: AccountEvent): void {
  for (const c of commitments ?? []) {
    const owner = c.owner?.trim() ? c.owner : null;
    const ownerResolution: ResolutionState = owner ? "resolved" : (c.resolution as ResolutionState) ?? "missing_context";
    const due = deadlineOf(c.deadline);
    const key = commitmentKey(c.action, owner);

    const existing = snapshot.commitments.find((x) => commitmentKey(x.description, x.owner) === key && x.condition);
    if (existing) {
      existing.updatedAt = event.occurredAt;
      continue;
    }

    snapshot.commitments.push({
      id: c.id ?? stableId("cmt", key + "|" + norm(c.condition)),
      accountId: event.accountId,
      type: "internal",
      description: c.action,
      owner,
      ownerResolution,
      dueDate: due.value,
      dueDateText: due.text,
      dueDateResolution: due.resolution,
      condition: c.condition,
      status: "open", // open, gated on condition
      sourceEvidence: [{ source, reference: event.sourceReference }],
      relatedTaskIds: [],
      relatedEmailIds: [],
      fulfillment: null,
      createdAt: event.occurredAt,
      updatedAt: event.occurredAt,
    });
  }
}

function ingestQuestions(snapshot: AccountIntelligenceSnapshot, questions: SemanticPayload["questions"], source: SourceType, event: AccountEvent): void {
  for (const q of questions ?? []) {
    const text = q.text?.trim();
    if (!text) continue;
    // Rhetorical/social language is filtered upstream; the builder only ingests
    // explicitly-flagged customer questions and never classifies free text itself.
    const key = questionKey(text);
    if (snapshot.questions.some((x) => questionKey(x.question) === key)) continue;
    const resolution = q.resolution ?? "resolved";
    snapshot.questions.push({
      id: q.id ?? stableId("q", key),
      question: text,
      sourceEvidence: [{ source, reference: event.sourceReference }],
      askedAt: event.occurredAt,
      answer: null,
      answeredAt: null,
      status: resolution === "ambiguous" || resolution === "conflicting" ? "ambiguous" : "open",
    });
  }
}

function ingestDecisions(snapshot: AccountIntelligenceSnapshot, decisions: Decision[] | undefined, source: SourceType, event: AccountEvent): void {
  for (const d of decisions ?? []) {
    const key = norm(d.text);
    if (snapshot.decisions.some((x) => norm(x.text) === key)) continue;
    snapshot.decisions.push({
      id: d.id ?? stableId("dec", key),
      text: d.text,
      decidedBy: d.decidedBy?.trim() ? d.decidedBy : null,
      source,
      sourceReference: event.sourceReference,
      occurredAt: event.occurredAt,
    });
  }
}

/** Ingest Step-50 reconciliation/execution gaps (reused primitives, not re-derived). */
function ingestGaps(snapshot: AccountIntelligenceSnapshot, gaps: ReconciliationGapRef[] | undefined): void {
  for (const g of gaps ?? []) {
    if (!g?.title) continue;
    const key = `${String(g.type ?? "")}:${norm(g.title)}`;
    if (snapshot.reconciliationGaps.some((x) => `${x.type ?? ""}:${norm(x.title)}` === key)) continue;
    snapshot.reconciliationGaps.push({
      type: String(g.type ?? ""),
      what: String(g.what ?? ""),
      title: String(g.title),
      description: String(g.description ?? ""),
    });
  }
}

/** Resolve open questions from explicit answer evidence (by id or exact text). */
function ingestAnswers(snapshot: AccountIntelligenceSnapshot, answers: SemanticPayload["answers"], source: SourceType, reference: string | null, at: string): void {
  for (const a of answers ?? []) {
    if (!a.text?.trim()) continue;
    const q = snapshot.questions.find(
      (x) => x.status === "open" && ((a.questionId && x.id === a.questionId) || (a.questionText && questionKey(x.question) === questionKey(a.questionText))),
    );
    if (!q) continue;
    q.status = "answered";
    q.answer = { text: a.text, source, reference };
    q.answeredAt = at;
  }
}

function ingestOwnerResolutions(snapshot: AccountIntelligenceSnapshot, resolutions: SemanticPayload["ownerResolutions"], event: AccountEvent): void {
  for (const r of resolutions ?? []) {
    const c = snapshot.commitments.find(
      (x) => (r.commitmentId && x.id === r.commitmentId) || (r.description && norm(x.description) === norm(r.description)),
    );
    if (!c) continue;
    if (r.owner?.trim()) {
      c.owner = r.owner;
      c.ownerResolution = "resolved";
      if (c.status === "ambiguous" && c.dueDateResolution !== "ambiguous") c.status = "open";
      c.updatedAt = event.occurredAt;
    }
  }
}

interface CommitmentUpdate {
  commitmentId?: string;
  description?: string;
  status?: CommitmentStatus;
  owner?: string | null;
  dueDate?: string | null;
  /** Explicitly "there is no deadline" — distinct from "we don't know yet". */
  dueDateWaived?: boolean;
  type?: CommitmentType;
}

/**
 * `provenance` marks who supplied the corrected field. Source evidence is never
 * touched here, so history is never rewritten to look like the customer said it.
 */
function applyCommitmentUpdates(
  snapshot: AccountIntelligenceSnapshot,
  updates: CommitmentUpdate[] | undefined,
  event: AccountEvent,
  provenance?: FieldProvenance,
  resolvedBy?: string | null,
): void {
  for (const u of updates ?? []) {
    const c = snapshot.commitments.find(
      (x) => (u.commitmentId && x.id === u.commitmentId) || (u.description && norm(x.description) === norm(u.description)),
    );
    if (!c) continue;
    if (u.status) c.status = u.status;
    if (u.owner !== undefined) {
      c.owner = u.owner?.trim() ? u.owner : null;
      c.ownerResolution = u.owner?.trim() ? "resolved" : null;
      if (provenance) {
        c.ownerProvenance = provenance;
        c.ownerResolvedBy = resolvedBy ?? null;
        c.ownerResolvedAt = event.occurredAt;
      }
    }
    if (u.dueDate !== undefined) {
      c.dueDate = u.dueDate;
      c.dueDateResolution = u.dueDate ? "resolved" : null;
      if (u.dueDate) c.dueDateWaived = false;
      if (provenance) {
        c.dueDateProvenance = provenance;
        c.dueDateResolvedBy = resolvedBy ?? null;
        c.dueDateResolvedAt = event.occurredAt;
      }
    }
    if (u.dueDateWaived === true) {
      // No date is invented. The commitment simply stops asking for one.
      c.dueDateWaived = true;
      c.dueDateResolution = "unsupported";
      if (provenance) {
        c.dueDateProvenance = provenance;
        c.dueDateResolvedBy = resolvedBy ?? null;
        c.dueDateResolvedAt = event.occurredAt;
      }
    }
    if (u.type) c.type = u.type;
    if (c.status === "ambiguous" && c.ownerResolution === "resolved" && c.dueDateResolution !== "ambiguous") c.status = "open";
    c.updatedAt = event.occurredAt;
  }
}


interface QuestionUpdate {
  questionId?: string;
  question?: string;
  status?: QuestionStatus;
}

function applyQuestionUpdates(snapshot: AccountIntelligenceSnapshot, updates: QuestionUpdate[] | undefined, event: AccountEvent): void {
  for (const u of updates ?? []) {
    const q = snapshot.questions.find(
      (x) => (u.questionId && x.id === u.questionId) || (u.question && questionKey(x.question) === questionKey(u.question)),
    );
    if (!q) continue;
    if (u.status) q.status = u.status;
  }
}

function linkCommitmentToTask(snapshot: AccountIntelligenceSnapshot, p: Record<string, unknown>, at: string): void {
  const taskId = typeof p.taskId === "string" ? p.taskId : null;
  const commitmentId = typeof p.commitmentId === "string" ? p.commitmentId : null;
  const description = typeof p.description === "string" ? p.description : typeof p.action === "string" ? p.action : null;
  if (!taskId) return;
  const c = snapshot.commitments.find(
    (x) => (commitmentId && x.id === commitmentId) || (description && norm(x.description) === norm(description)),
  );
  if (c && !c.relatedTaskIds.includes(taskId)) {
    c.relatedTaskIds.push(taskId);
    c.updatedAt = at;
  }
}

function fulfillCommitmentByTask(snapshot: AccountIntelligenceSnapshot, p: Record<string, unknown>, event: AccountEvent): void {
  const taskId = typeof p.taskId === "string" ? p.taskId : null;
  if (!taskId) return;
  for (const c of snapshot.commitments) {
    if (c.relatedTaskIds.includes(taskId) && (c.status === "open" || c.status === "in_progress")) {
      c.status = "fulfilled";
      c.fulfillment = { source: "tasks", reference: taskId, occurredAt: event.occurredAt };
      c.updatedAt = event.occurredAt;
    }
  }
}

/**
 * Gmail evidence may fulfil a commitment only when the email actually contains
 * the promised artifact/action. The builder never fulfils on "sounds similar" —
 * it requires an explicit commitment link (id or exact description) and a
 * `delivered: true` signal carrying the artifact reference.
 */
function applyEmailFulfillment(snapshot: AccountIntelligenceSnapshot, p: Record<string, unknown>, event: AccountEvent): void {
  const reference = typeof p.reference === "string" ? p.reference : event.sourceReference;
  const commitmentId = typeof p.commitmentId === "string" ? p.commitmentId : null;
  const description = typeof p.description === "string" ? p.description : typeof p.action === "string" ? p.action : null;
  const delivered = p.delivered === true;
  if (!delivered) return;

  const c = snapshot.commitments.find(
    (x) => (commitmentId && x.id === commitmentId) || (description && norm(x.description) === norm(description)),
  );
  if (!c) return;
  if (!c.relatedEmailIds.includes(reference ?? "")) c.relatedEmailIds.push(reference ?? "");
  if (c.status === "open" || c.status === "in_progress") {
    c.status = "fulfilled";
    c.fulfillment = { source: "gmail", reference, occurredAt: event.occurredAt };
    c.updatedAt = event.occurredAt;
  }
}

/**
 * Derive time-dependent "overdue" deterministically from dueDate vs now.
 * Returns a copy so the base snapshot remains pure/stable.
 */
export function deriveOverdue(snapshot: AccountIntelligenceSnapshot, now: string): AccountIntelligenceSnapshot {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) return snapshot;
  const next: AccountIntelligenceSnapshot = {
    ...snapshot,
    commitments: snapshot.commitments.map((c) => {
      if (c.status === "open" && c.dueDate && c.dueDateResolution === "resolved") {
        const dueMs = Date.parse(c.dueDate);
        if (!Number.isNaN(dueMs) && dueMs < nowMs) return { ...c, status: "overdue" };
      }
      return c;
    }),
  };
  return next;
}

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
    reconciliationGaps: [...snapshot.reconciliationGaps],
    unavailableSources: [...snapshot.unavailableSources],
    version: snapshot.version + 1,
  };
  next.recentEvents = [{ eventType: event.eventType, occurredAt: event.occurredAt }, ...snapshot.recentEvents].slice(0, 50);

  const p = event.payload ?? {};
  const source = (event.source as SourceType | null) ?? "system";
  const occurredAt = event.occurredAt;

  if (Array.isArray(p.unavailableSources)) next.unavailableSources = union(next.unavailableSources, p.unavailableSources as SourceType[]);

  switch (event.eventType) {
    case "crm_state_observed":
      if (p.unavailable === true) next.unavailableSources = union(next.unavailableSources, "hubspot");
      else if (typeof p.stage === "string") {
        next.stage = p.stage;
        next.stageSource = "hubspot";
        next.lastSourceRefresh = occurredAt;
      }
      if (p.identity && typeof p.identity === "object") next.identity = { ...(p.identity as AccountIntelligenceSnapshot["identity"]) };
      break;

    case "commercial_state_observed":
      if (p.unavailable === true) next.unavailableSources = union(next.unavailableSources, "commercial");
      else if (typeof p.status === "string") {
        next.commercial = { status: p.status, provenance: (event.provenance ?? (p.provenance as string) ?? null) };
        next.lastSourceRefresh = occurredAt;
      }
      break;

    case "manual_interaction_processed":
    case "interaction_processed":
    case "meeting_processed": {
      const semantic = (p.semantic ?? {}) as SemanticPayload;
      ingestCommitments(next, semantic.confirmedCommitments, source, event);
      ingestConditionalCommitments(next, semantic.conditionalCommitments, source, event);
      ingestQuestions(next, semantic.questions, source, event);
      ingestDecisions(next, semantic.decisions, source, event);
      next.blockers = union(next.blockers, semantic.blockers);
      ingestAnswers(next, semantic.answers, source, event.sourceReference, occurredAt);
      ingestOwnerResolutions(next, semantic.ownerResolutions, event);
      ingestGaps(next, p.gaps as ReconciliationGapRef[] | undefined);
      break;
    }

    case "task_created":
      linkCommitmentToTask(next, p, occurredAt);
      break;

    case "task_completed":
      fulfillCommitmentByTask(next, p, event);
      break;

    case "email_observed":
      applyEmailFulfillment(next, p, event);
      ingestAnswers(next, p.answers as SemanticPayload["answers"], "gmail", event.sourceReference, occurredAt);
      break;

    case "external_action_executed":
      if (typeof p.actionType === "string") {
        if (p.status === "failed") next.executionGaps = union(next.executionGaps, `${p.actionType}:${(p.target as string) ?? ""}`);
        else next.nextSteps = union(next.nextSteps, `executed:${p.actionType}`);
      }
      break;

    case "proposal_approved":
    case "proposal_rejected":
    case "manual_correction":
      next.lastReviewed = occurredAt;
      if (event.eventType === "manual_correction") {
        // Human-supplied context is tagged so the UI can always distinguish it
        // from what a source actually reported.
        const humanProvenance: FieldProvenance | undefined = p.provenanceTag === "human_supplied" ? "human_supplied" : undefined;
        const resolvedBy = typeof p.resolvedBy === "string" ? p.resolvedBy : null;
        if (typeof p.stage === "string") next.stage = p.stage;
        if (typeof p.status === "string") next.commercial = { status: p.status, provenance: event.provenance ?? "manual_correction" };
        if (p.identityUpdates && typeof p.identityUpdates === "object") {
          // Identity linkage only (company/contact/deal). Never stage or commercial truth.
          const u = p.identityUpdates as Record<string, unknown>;
          const patch: NonNullable<AccountIntelligenceSnapshot["identity"]> = { ...(next.identity ?? {}) };
          if (typeof u.companyId === "string") patch.companyId = u.companyId;
          if (typeof u.contactId === "string") patch.contactId = u.contactId;
          if (typeof u.dealId === "string") patch.dealId = u.dealId;
          next.identity = patch;
        }
        if (p.ownerResolutions) ingestOwnerResolutions(next, p.ownerResolutions as SemanticPayload["ownerResolutions"], event);
        if (p.commitmentUpdates) applyCommitmentUpdates(next, p.commitmentUpdates as CommitmentUpdate[], event, humanProvenance, resolvedBy);
        if (p.questionUpdates) applyQuestionUpdates(next, p.questionUpdates as QuestionUpdate[], event);
        if (p.risks) next.risks = union(next.risks, p.risks as string[]);
        if (Array.isArray(p.resolvedBlockers)) {
          const resolved = new Set(p.resolvedBlockers as string[]);
          next.blockers = next.blockers.filter((b) => !resolved.has(b));
        }
      }

      break;
  }

  return next;
}

export interface BuildStateOptions {
  prior?: AccountIntelligenceSnapshot;
  /** Reference clock for deterministic overdue derivation. */
  now?: string;
}

export function buildState(events: AccountEvent[], opts: BuildStateOptions = {}): AccountIntelligenceSnapshot {
  const prior = opts.prior ?? EMPTY_SNAPSHOT;
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
    reconciliationGaps: [...(prior.reconciliationGaps ?? [])],
    unavailableSources: [...(prior.unavailableSources ?? [])],
    recentEvents: [...(prior.recentEvents ?? [])],
  };

  for (const event of ordered) state = reduceEvent(state, event);

  return deriveOverdue(state, opts.now ?? new Date().toISOString());
}
