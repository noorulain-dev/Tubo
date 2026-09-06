import type { CommercialState } from "../commercial.js";
import type { DealRecord } from "../providers.js";
import type { RiskLevel } from "../reconciliation/finding.js";
import { AuditService, NoopAuditSink } from "../audit-service.js";

export const POLICY_ACTIONS = ["informational", "safe_to_prepare", "approval_required", "blocked"] as const;
export type PolicyAction = (typeof POLICY_ACTIONS)[number];

export interface PolicyEvaluation {
  action: PolicyAction;
  ruleId: string;
  reasonCode: string;
  risk: RiskLevel;
  requiresApproval: boolean;
  allowlisted: boolean;
  reasons: string[];
  /** Inputs the decision was based on (for audit). */
  inputs: unknown;
}

export interface PolicyContext {
  commercialState: CommercialState | null;
  openDeal: DealRecord | null;
  /** Reference "now" for grace-period comparisons (ISO 8601). */
  now?: string;
}

export interface ActionRequest {
  /** String, not a closed enum, so unsupported actions can be detected. */
  type: string;
  payload?: Record<string, unknown>;
}

export const EXECUTOR_ALLOWLIST = [
  "create_note",
  "create_task",
  "update_field",
  "update_stage",
  "create_draft",
] as const;
export const INFORMATIONAL_ACTIONS = ["flag_for_review", "log_security_event", "none"] as const;

const INJECTION_PATTERN =
  /\b(system override|ignore (all )?previous instructions|admin mode|override (your )?policy|mark every deal|delete all)\b/i;
const POLICY_OVERRIDE_PATTERN =
  /(self.?approve|auto.?approve|bypass (approval|policy)|"requiresapproval"\s*:\s*false|"approved"\s*:\s*true)/i;
const HIGH_IMPACT_PATTERN = /(cancel|downgrade|delete|terminate|refund|purge)/i;

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
}

/**
 * Closed Won eligibility: authoritative commercial state must show an active
 * subscription/conversion, and the deal must not already be Closed Won.
 * Conversation evidence does NOT independently prove conversion.
 */
export function closedWonEligible(ctx: PolicyContext): EligibilityResult {
  if (!ctx.commercialState) return { eligible: false, reason: "missing_commercial_context" };
  if (ctx.commercialState.subscription?.status !== "active") {
    return { eligible: false, reason: "no_active_subscription" };
  }
  if ((ctx.openDeal?.stage ?? "").toLowerCase() === "closedwon") {
    return { eligible: false, reason: "already_closed_won" };
  }
  return { eligible: true, reason: "" };
}

/**
 * Closed Lost eligibility: trial ended + grace elapsed + no active subscription
 * + no approved exception + deal not already closed.
 */
export function closedLostEligible(ctx: PolicyContext): EligibilityResult {
  if (!ctx.commercialState) return { eligible: false, reason: "missing_commercial_context" };
  const trial = ctx.commercialState.trial;
  if (trial?.status !== "ended") return { eligible: false, reason: "trial_not_ended" };
  const now = ctx.now ?? new Date().toISOString();
  const graceElapsed = trial.graceEndsAt == null ? true : trial.graceEndsAt < now;
  if (!graceElapsed) return { eligible: false, reason: "grace_period_not_elapsed" };
  if (ctx.commercialState.subscription?.status === "active") {
    return { eligible: false, reason: "subscription_active" };
  }
  if (ctx.commercialState.commercialException?.approved) {
    return { eligible: false, reason: "approved_exception" };
  }
  const stage = (ctx.openDeal?.stage ?? "").toLowerCase();
  if (stage === "closedwon" || stage === "closedlost") {
    return { eligible: false, reason: "deal_already_closed" };
  }
  return { eligible: true, reason: "" };
}

/**
 * Deterministic policy evaluation. LLM/agent output has ZERO policy authority;
 * this function is the sole gatekeeper.
 */
export function evaluateAction(action: ActionRequest, ctx: PolicyContext): PolicyEvaluation {
  const payloadText = action.payload ? JSON.stringify(action.payload) : "";
  const combined = `${action.type} ${payloadText}`;
  const allowlisted = (EXECUTOR_ALLOWLIST as readonly string[]).includes(action.type);

  // 1. Source content attempts to bypass policy.
  if (INJECTION_PATTERN.test(combined)) {
    return decision("blocked", "POLICY_BYPASS", "source_contains_policy_bypass", "critical", action, ctx, false, allowlisted);
  }
  // 2. Proposal attempts a policy override (self-approve / disable approval).
  if (POLICY_OVERRIDE_PATTERN.test(combined)) {
    return decision("blocked", "POLICY_OVERRIDE", "policy_override_attempt", "critical", action, ctx, false, allowlisted);
  }
  // 3. External send requested.
  if (action.type === "send" || action.type === "send_email" || (action.type === "create_draft" && action.payload?.send === true)) {
    return decision("blocked", "SEND", "external_send_requested", "critical", action, ctx, false, allowlisted);
  }
  // 4. Unsupported high-impact mutation.
  if (HIGH_IMPACT_PATTERN.test(action.type)) {
    return decision("blocked", "HIGH_IMPACT", "unsupported_high_impact_mutation", "high", action, ctx, false, allowlisted);
  }
  // 5. Action outside allowlist (and not informational).
  if (!allowlisted && !(INFORMATIONAL_ACTIONS as readonly string[]).includes(action.type)) {
    return decision("blocked", "ALLOWLIST", "action_outside_allowlist", "high", action, ctx, false, false);
  }

  // 6. Lifecycle transitions.
  if (action.type === "update_stage") {
    const stage = String(action.payload?.stage ?? "");
    if (stage === "closedwon") {
      const e = closedWonEligible(ctx);
      if (!e.eligible) return decision("blocked", "CLOSED_WON", e.reason, "high", action, ctx, false, true);
      return decision("approval_required", "CLOSED_WON", "closed_won_approval_required", "medium", action, ctx, true, true);
    }
    if (stage === "closedlost") {
      const e = closedLostEligible(ctx);
      if (!e.eligible) return decision("blocked", "CLOSED_LOST", e.reason, "high", action, ctx, false, true);
      return decision("approval_required", "CLOSED_LOST", "closed_lost_approval_required", "medium", action, ctx, true, true);
    }
    return decision("approval_required", "STAGE_CHANGE", "deal_stage_mutation", "medium", action, ctx, true, true);
  }

  // 7. Default mapping for allowlisted/informational actions.
  switch (action.type) {
    case "create_note":
      return decision("safe_to_prepare", "CREATE_NOTE", "note_is_safe", "low", action, ctx, false, true);
    case "create_task":
      return decision("approval_required", "CREATE_TASK", "task_requires_approval", "low", action, ctx, true, true);
    case "update_field":
      return decision("approval_required", "FIELD_MUTATION", "crm_field_mutation", "medium", action, ctx, true, true);
    case "create_draft":
      return decision("approval_required", "CREATE_DRAFT", "draft_requires_approval", "low", action, ctx, true, true);
    default:
      return decision("informational", "NO_ACTION", "no_action_required", "low", action, ctx, false, false);
  }
}

function decision(
  action: PolicyAction,
  ruleId: string,
  reasonCode: string,
  risk: RiskLevel,
  req: ActionRequest,
  ctx: PolicyContext,
  requiresApproval: boolean,
  allowlisted: boolean,
): PolicyEvaluation {
  return {
    action,
    ruleId,
    reasonCode,
    risk,
    requiresApproval,
    allowlisted,
    reasons: [reasonCode],
    inputs: { action: req, commercialState: ctx.commercialState, openDealStage: ctx.openDeal?.stage ?? null, now: ctx.now },
  };
}

export class PolicyEngine {
  constructor(private readonly audit: AuditService = new AuditService(new NoopAuditSink())) {}

  evaluate(action: ActionRequest, ctx: PolicyContext): PolicyEvaluation {
    const result = evaluateAction(action, ctx);
    this.audit.emit({
      eventType: "policy.decision",
      payload: {
        ruleId: result.ruleId,
        reasonCode: result.reasonCode,
        action: result.action,
        risk: result.risk,
        requiresApproval: result.requiresApproval,
      },
    });
    return result;
  }
}
