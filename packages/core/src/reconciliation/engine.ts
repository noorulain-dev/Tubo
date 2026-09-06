import type { EvidenceSpan } from "../domain.js";
import type {
  GapType,
  GapWhat,
  SourceType,
} from "../enums.js";
import { FACT_AUTHORITY, type SourceAuthority } from "../operational.js";
import type {
  Commitment,
  CommercialSignal,
  SemanticState,
  TaskCandidate,
} from "../semantic.js";
import type {
  ContactRecord,
  DealRecord,
  EmailThreadRecord,
  NoteRecord,
  TaskRecord,
} from "../providers.js";
import type { ProposedAction } from "../policy.js";
import type { CommercialState } from "../commercial.js";
import type { ExecutionGap } from "../reconciliation.js";
import type { ReconciliationFinding, RiskLevel } from "./finding.js";

export interface OperationalContext {
  contacts: ContactRecord[];
  openDeal: DealRecord | null;
  recentNotes: NoteRecord[];
  openTasks: TaskRecord[];
  commercialState: CommercialState | null;
  emailThread: EmailThreadRecord | null;
}

export interface ReconciliationInput {
  state: SemanticState;
  context: OperationalContext;
}

const CONSEQUENTIAL_PATTERN = /\b(cancel|downgrade|delete|terminate|refund)\b/i;
const INJECTION_PATTERN =
  /\b(ignore (all )?previous instructions|system override|admin mode|override (your )?policy|delete all tasks|mark every deal)\b/i;

export function isConsequential(text: string): boolean {
  return CONSEQUENTIAL_PATTERN.test(text);
}

export function isInjection(text: string): boolean {
  return INJECTION_PATTERN.test(text);
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function findEquivalentTask(action: string, tasks: TaskRecord[]): TaskRecord | null {
  const target = normalizeTitle(action);
  return tasks.find((t) => normalizeTitle(t.title) === target) ?? null;
}

const CONVERSATION_AUTHORITY: SourceAuthority = { source: "conversation", authority: "evidence" };
const TASK_AUTHORITY: SourceAuthority = { source: "tasks", authority: "authoritative" };
const COMMERCIAL_AUTHORITY: SourceAuthority = { source: "commercial", authority: "authoritative" };
const HUBSPOT_AUTHORITY: SourceAuthority = { source: "hubspot", authority: "authoritative" };

interface Base {
  claimRef: string;
  semanticItem: unknown;
  currentState: unknown;
  evidence: EvidenceSpan[];
}

/**
 * Source-aware reconciliation. For every relevant semantic item, compare it
 * against the authoritative operational context and emit a classified finding.
 */
export function reconcile(input: ReconciliationInput): ReconciliationFinding[] {
  const findings: ReconciliationFinding[] = [];

  input.state.confirmedCommitments.forEach((c, i) => {
    findings.push(reconcileCommitment(`confirmedCommitment:${i}`, c, input.context));
  });

  input.state.taskCandidates.forEach((t, i) => {
    findings.push(reconcileTaskCandidate(`taskCandidate:${i}`, t, input.context));
  });

  input.state.commercialSignals.forEach((s, i) => {
    findings.push(reconcileCommercialSignal(`commercialSignal:${i}`, s, input.context));
  });

  return findings;
}

function reconcileCommitment(claimRef: string, c: Commitment, ctx: OperationalContext): ReconciliationFinding {
  const base: Base = {
    claimRef,
    semanticItem: c,
    currentState: { openTaskTitles: ctx.openTasks.map((t) => t.title) },
    evidence: c.evidence,
  };
  const text = [c.action, ...c.evidence.map((e) => e.text)].join(" ");

  if (isInjection(text)) {
    return { ...base, classification: "unsafe", relevantSources: ["conversation"], authoritativeSource: CONVERSATION_AUTHORITY, rationaleCode: "injection_detected", risk: "critical", reason: "injected instruction detected; treated as data, not action" };
  }
  if (isConsequential(c.action)) {
    return { ...base, classification: "unsafe", relevantSources: ["conversation"], authoritativeSource: CONVERSATION_AUTHORITY, rationaleCode: "consequential_action", risk: "high", reason: "action is consequential/unsupported and must not auto-execute" };
  }
  if (c.owner == null || c.resolution === "ambiguous") {
    return { ...base, classification: "ambiguous", relevantSources: ["conversation"], authoritativeSource: CONVERSATION_AUTHORITY, rationaleCode: "unresolvable_identity", risk: "medium", reason: "owner/identity unresolved; do not invent an owner" };
  }
  if (c.deadline && c.deadline.resolution === "ambiguous") {
    return { ...base, classification: "ambiguous", relevantSources: ["conversation"], authoritativeSource: CONVERSATION_AUTHORITY, rationaleCode: "unresolvable_date", risk: "medium", reason: "deadline ambiguous; do not invent a date" };
  }

  const existing = findEquivalentTask(c.action, ctx.openTasks);
  if (existing) {
    return { ...base, classification: "duplicate", relevantSources: ["conversation", "tasks"], authoritativeSource: TASK_AUTHORITY, rationaleCode: "equivalent_action_exists", risk: "low", reason: "equivalent task already exists; do not create another" };
  }

  return {
    ...base,
    classification: "missing",
    relevantSources: ["conversation", "tasks"],
    authoritativeSource: TASK_AUTHORITY,
    rationaleCode: "no_operational_representation",
    risk: "medium",
    reason: "confirmed commitment has no operational representation",
    proposedAction: {
      type: "create_task",
      target: "task",
      payload: { title: c.action, owner: c.owner, dueDate: c.deadline?.value ?? null },
      requiresApproval: false,
      blocked: false,
    },
  };
}

function reconcileTaskCandidate(claimRef: string, t: TaskCandidate, ctx: OperationalContext): ReconciliationFinding {
  const base: Base = {
    claimRef,
    semanticItem: t,
    currentState: { openTaskTitles: ctx.openTasks.map((x) => x.title) },
    evidence: t.evidence,
  };

  if (isConsequential(t.action)) {
    return { ...base, classification: "unsafe", relevantSources: ["conversation"], authoritativeSource: CONVERSATION_AUTHORITY, rationaleCode: "consequential_action", risk: "high", reason: "action is consequential/unsupported and must not auto-execute" };
  }

  const existing = findEquivalentTask(t.action, ctx.openTasks);
  if (existing) {
    return { ...base, classification: "duplicate", relevantSources: ["conversation", "tasks"], authoritativeSource: TASK_AUTHORITY, rationaleCode: "equivalent_action_exists", risk: "low", reason: "equivalent task already exists; do not create another" };
  }

  return {
    ...base,
    classification: "missing",
    relevantSources: ["conversation", "tasks"],
    authoritativeSource: TASK_AUTHORITY,
    rationaleCode: "no_operational_representation",
    risk: "medium",
    reason: "action has no operational representation",
    proposedAction: {
      type: "create_task",
      target: "task",
      payload: { title: t.action, owner: t.owner, dueDate: t.deadline?.value ?? null },
      requiresApproval: false,
      blocked: false,
    },
  };
}

function reconcileCommercialSignal(claimRef: string, s: CommercialSignal, ctx: OperationalContext): ReconciliationFinding {
  const base: Base = {
    claimRef,
    semanticItem: s,
    currentState: {
      subscription: ctx.commercialState?.subscription ?? null,
      hubspotStage: ctx.openDeal?.stage ?? null,
    },
    evidence: s.evidence,
  };
  const relevantSources: SourceType[] = ["conversation", "commercial", "hubspot"];

  if (!ctx.commercialState) {
    return { ...base, classification: "ambiguous", relevantSources, authoritativeSource: COMMERCIAL_AUTHORITY, rationaleCode: "missing_context", risk: "high", reason: "commercial state unavailable; cannot determine subscription reality" };
  }

  const commercialActive = ctx.commercialState.subscription?.status === "active";
  const hubspotClosed = (ctx.openDeal?.stage ?? "").toLowerCase() === "closedwon";

  if (s.kind === "intent_to_subscribe") {
    // Intent is not an active subscription. Never claim Closed Won from intent.
    return { ...base, classification: "aligned", relevantSources, authoritativeSource: COMMERCIAL_AUTHORITY, rationaleCode: "intent_not_subscription_state", risk: "low", reason: "subscription intent does not equal an active subscription; no Closed Won" };
  }

  if (s.kind === "claims_subscribed") {
    if (commercialActive && !hubspotClosed) {
      return {
        ...base,
        classification: "stale",
        relevantSources,
        authoritativeSource: COMMERCIAL_AUTHORITY,
        rationaleCode: "newer_authoritative_evidence",
        risk: "medium",
        reason: "commercial state shows active subscription but HubSpot is not Closed Won; HubSpot is stale",
        proposedAction: {
          type: "update_stage",
          target: ctx.openDeal?.id ?? "deal",
          payload: { stage: "closedwon" },
          requiresApproval: true,
          blocked: false,
          reviewReason: "Closed Won requires human approval",
        },
      };
    }
    if (!commercialActive) {
      return { ...base, classification: "contradictory", relevantSources, authoritativeSource: COMMERCIAL_AUTHORITY, rationaleCode: "source_conflict", risk: "high", reason: "conversation claims subscription but authoritative commercial state is not active" };
    }
    return { ...base, classification: "aligned", relevantSources, authoritativeSource: COMMERCIAL_AUTHORITY, rationaleCode: "state_matches", risk: "low", reason: "commercial state and CRM already reflect the subscription" };
  }

  return { ...base, classification: "aligned", relevantSources, authoritativeSource: COMMERCIAL_AUTHORITY, rationaleCode: "state_matches", risk: "low", reason: "no material reconciliation gap" };
}

const WHAT_BY_CLASSIFICATION: Partial<Record<GapType, GapWhat>> = {
  missing: "missing",
  stale: "stale",
  contradictory: "conflict",
  ambiguous: "needs_review",
  unsafe: "needs_review",
};

function severityForRisk(risk: RiskLevel): ExecutionGap["severity"] {
  return risk === "critical" || risk === "high" ? "critical" : risk === "medium" ? "warning" : "info";
}

/**
 * Convert non-aligned findings into actionable execution gaps.
 */
export function detectExecutionGaps(findings: ReconciliationFinding[]): ExecutionGap[] {
  const gaps: ExecutionGap[] = [];
  for (const f of findings) {
    const what = WHAT_BY_CLASSIFICATION[f.classification];
    if (!what) continue;
    gaps.push({
      type: f.classification,
      what,
      title: `${f.classification}: ${f.claimRef}`,
      description: f.reason,
      evidence: f.evidence,
      severity: severityForRisk(f.risk),
    });
  }
  return gaps;
}

/**
 * Reconcile the authoritative commercial state against the recorded CRM stage,
 * independent of any conversation signal. This is what drives Closed Won /
 * Closed Lost eligibility proposals. The policy engine performs the final
 * eligibility check (grace period, exception, etc.).
 */
export function reconcileOperationalState(ctx: OperationalContext): ReconciliationFinding[] {
  const findings: ReconciliationFinding[] = [];
  const commercial = ctx.commercialState;
  const deal = ctx.openDeal;
  if (!commercial || !deal) return findings;

  const stage = (deal.stage ?? "").toLowerCase();
  const subActive = commercial.subscription?.status === "active";
  const trialEnded = commercial.trial?.status === "ended";
  const hasException = commercial.commercialException?.approved === true;
  const sources: SourceType[] = ["commercial", "hubspot"];

  if (subActive && stage !== "closedwon") {
    findings.push({
      classification: "stale",
      claimRef: "operational:subscription_vs_stage",
      semanticItem: { dealId: deal.id },
      currentState: { commercial: "active", hubspotStage: stage },
      relevantSources: sources,
      authoritativeSource: COMMERCIAL_AUTHORITY,
      evidence: [],
      rationaleCode: "newer_authoritative_evidence",
      risk: "medium",
      reason: "commercial state is active but HubSpot is not Closed Won",
      proposedAction: {
        type: "update_stage",
        target: deal.id,
        payload: { stage: "closedwon" },
        requiresApproval: true,
        blocked: false,
        reviewReason: "Closed Won requires human approval",
      },
    });
  }

  if (trialEnded && !subActive && !hasException && stage === "trial") {
    findings.push({
      classification: "stale",
      claimRef: "operational:trial_expired_vs_stage",
      semanticItem: { dealId: deal.id },
      currentState: { commercial: "trial_ended", hubspotStage: stage },
      relevantSources: sources,
      authoritativeSource: COMMERCIAL_AUTHORITY,
      evidence: [],
      rationaleCode: "newer_authoritative_evidence",
      risk: "medium",
      reason: "trial expired with no active subscription; HubSpot still Trial",
      proposedAction: {
        type: "update_stage",
        target: deal.id,
        payload: { stage: "closedlost" },
        requiresApproval: true,
        blocked: false,
        reviewReason: "Closed Lost requires human approval",
      },
    });
  }

  return findings;
}

export { FACT_AUTHORITY, HUBSPOT_AUTHORITY };
