import {
  evaluateAction,
  type Approval,
  type ExecutionResult,
  type PolicyContext,
  type PolicyEvaluation,
  type ProposedAction,
} from "./core.js";
import { getPool } from "./db.js";

/**
 * STEP 56 — Evidence-Backed Execution Plans.
 *
 * A thin coordination layer over the existing ProposedAction architecture. A
 * confirmed account issue may require several coordinated actions; each action
 * remains an independently policy-controlled ProposedAction. The AI may
 * summarize/sequence/draft/explain/connect, but it never invents owner/deadline/
 * commercial facts, never overrides policy, and never approves/executes/sends.
 *
 * Every action is re-validated server-side via `evaluateAction`; partial approval
 * is supported; a blocked action does not block unrelated safe actions; only an
 * explicit `dependsOn` link marks a downstream action dependency-blocked.
 */

export type PlanActionStatus =
  | "blocked"
  | "pending_approval"
  | "ready"
  | "informational"
  | "approved"
  | "rejected"
  | "executed"
  | "failed";

export interface ExecutionPlanAction {
  actionId: string;
  /** The existing ProposedAction (reused, not replaced). */
  action: ProposedAction;
  /** Server-side policy revalidation result. */
  policy: PolicyEvaluation;
  status: PlanActionStatus;
  dependsOn: string[];
  dependencyBlocked: boolean;
  approval?: Approval;
  execution?: ExecutionResult;
}

export interface ExecutionPlan {
  planId: string;
  accountId: string;
  findingIds: string[];
  objective: string;
  summary: string;
  evidence: string[];
  actions: ExecutionPlanAction[];
  /** Snapshot used for edit revalidation (not part of the public model). */
  policyContext: PolicyContext;
  createdAt: string;
}

export interface PlanActionInput {
  action: ProposedAction;
  dependsOn?: string[];
}

export interface BuildPlanInput {
  accountId: string;
  findingIds?: string[];
  objective: string;
  summary?: string;
  evidence?: string[];
  actions: PlanActionInput[];
  policyContext: PolicyContext;
  now?: string;
}

function hash(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Stable, idempotency-safe plan key so identical plans do not duplicate. */
export function planKey(accountId: string, objective: string, findingIds: string[]): string {
  const ids = [...findingIds].sort().join(",");
  return `plan_${hash(`${accountId}:${objective.trim().toLowerCase()}:${ids}`)}`;
}

function statusForPolicy(action: PolicyEvaluation["action"]): PlanActionStatus {
  switch (action) {
    case "blocked":
      return "blocked";
    case "approval_required":
      return "pending_approval";
    case "safe_to_prepare":
      return "ready";
    case "informational":
      return "informational";
  }
}

/**
 * Deterministic groundedness guard: the AI may not invent an owner. A task-like
 * action without a resolved owner is blocked (never fabricated).
 */
function groundednessIssue(action: ProposedAction): string | null {
  if (action.type === "create_task") {
    const owner = (action.payload as Record<string, unknown> | undefined)?.owner;
    if (!owner || typeof owner !== "string" || !owner.trim()) return "ambiguous_owner";
  }
  return null;
}

export function buildExecutionPlan(input: BuildPlanInput): ExecutionPlan {
  const now = input.now ?? new Date().toISOString();

  const actions: ExecutionPlanAction[] = input.actions.map((a, i) => {
    const actionId = a.action.id ?? `a${i + 1}`;
    const grounding = groundednessIssue(a.action);
    let policy = evaluateAction({ type: a.action.type, payload: a.action.payload as Record<string, unknown> | undefined }, input.policyContext);
    let status: PlanActionStatus;

    if (grounding) {
      policy = { ...policy, action: "blocked", ruleId: "GROUNDEDNESS", reasonCode: grounding, risk: "high", reasons: [...policy.reasons, grounding] };
      status = "blocked";
    } else {
      status = statusForPolicy(policy.action);
    }

    return {
      actionId,
      action: a.action,
      policy,
      status,
      dependsOn: a.dependsOn ?? [],
      dependencyBlocked: false,
    };
  });

  // Resolve explicit dependencies only. An unresolved upstream action marks a
  // downstream action dependency-blocked; unrelated actions are unaffected.
  const byId = new Map(actions.map((x) => [x.actionId, x]));
  for (const act of actions) {
    for (const depId of act.dependsOn) {
      const dep = byId.get(depId);
      if (!dep) continue;
      const unresolved = dep.status !== "approved" && dep.status !== "executed";
      if (unresolved) {
        act.dependencyBlocked = true;
        if (act.status !== "blocked") act.status = "blocked";
      }
    }
  }

  return {
    planId: planKey(input.accountId, input.objective, input.findingIds ?? []),
    accountId: input.accountId,
    findingIds: input.findingIds ?? [],
    objective: input.objective,
    summary: input.summary ?? "",
    evidence: input.evidence ?? [],
    actions,
    policyContext: input.policyContext,
    createdAt: now,
  };
}

export type PlanDecision = "approve" | "reject" | "edit";

export interface DecisionOptions {
  payload?: Record<string, unknown>;
  reviewer?: string;
}

/** Apply an approve/reject/edit decision to a single action, revalidating edits. */
export function applyDecision(plan: ExecutionPlan, actionId: string, decision: PlanDecision, opts: DecisionOptions = {}): ExecutionPlan {
  const now = new Date().toISOString();
  const reviewer = opts.reviewer ?? "user";

  const actions = plan.actions.map((a) => {
    if (a.actionId !== actionId) return a;
    const clone: ExecutionPlanAction = { ...a, action: { ...a.action }, dependsOn: [...a.dependsOn] };

    if (decision === "approve") {
      clone.status = "approved";
      clone.approval = { decision: "approve", reviewer, decidedAt: now };
    } else if (decision === "reject") {
      clone.status = "rejected";
      clone.approval = { decision: "reject", reviewer, decidedAt: now };
    } else {
      // edit → revalidate server-side
      const payload = opts.payload ?? (clone.action.payload as Record<string, unknown>);
      clone.action = { ...clone.action, payload };
      const grounding = groundednessIssue(clone.action);
      const policy = evaluateAction({ type: clone.action.type, payload: clone.action.payload as Record<string, unknown> | undefined }, plan.policyContext);
      clone.policy = grounding ? { ...policy, action: "blocked", ruleId: "GROUNDEDNESS", reasonCode: grounding, risk: "high", reasons: [...policy.reasons, grounding] } : policy;
      clone.status = grounding ? "blocked" : statusForPolicy(clone.policy.action);
      clone.approval = { decision: "edit", reviewer, editedPayload: payload, decidedAt: now };
      clone.execution = undefined;
    }
    return clone;
  });

  return recomputeDependencies({ ...plan, actions });
}

/** Approve every eligible action (pending_approval / ready); blocked/informational stay put. */
export function approveAllEligible(plan: ExecutionPlan, reviewer = "user"): ExecutionPlan {
  const now = new Date().toISOString();
  const actions = plan.actions.map((a) => {
    if (a.status === "pending_approval" || a.status === "ready") {
      return { ...a, status: "approved" as const, approval: { decision: "approve" as const, reviewer, decidedAt: now } };
    }
    return a;
  });
  return recomputeDependencies({ ...plan, actions });
}

/** Execute approved actions independently; a failure marks that action failed only. */
export async function executeApproved(
  plan: ExecutionPlan,
  executor: (action: ProposedAction) => Promise<ExecutionResult>,
): Promise<ExecutionPlan> {
  const actions: ExecutionPlanAction[] = [];
  for (const a of plan.actions) {
    if (a.status !== "approved") {
      actions.push(a);
      continue;
    }
    const result = await executor(a.action);
    actions.push({ ...a, status: result.status === "success" ? "executed" : "failed", execution: result });
  }
  return recomputeDependencies({ ...plan, actions });
}

function recomputeDependencies(plan: ExecutionPlan): ExecutionPlan {
  const byId = new Map(plan.actions.map((x) => [x.actionId, x]));
  const actions = plan.actions.map((a) => {
    let blocked = a.dependencyBlocked;
    for (const depId of a.dependsOn) {
      const dep = byId.get(depId);
      if (!dep) continue;
      blocked = dep.status !== "approved" && dep.status !== "executed";
      if (blocked) break;
    }
    const next = { ...a, dependencyBlocked: blocked };
    // A previously dependency-blocked action that is now unblocked reverts to its policy status.
    if (a.dependencyBlocked && !blocked && a.status === "blocked" && a.policy.action !== "blocked") {
      next.status = statusForPolicy(a.policy.action);
    }
    return next;
  });
  return { ...plan, actions };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function savePlan(userId: string, plan: ExecutionPlan): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO execution_plans (plan_id, user_id, account_id, plan, created_at, updated_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,now())
     ON CONFLICT (plan_id) DO UPDATE SET plan = EXCLUDED.plan, updated_at = now()`,
    [plan.planId, userId, plan.accountId, JSON.stringify(plan), plan.createdAt],
  );
}

export async function getPlan(userId: string, planId: string): Promise<ExecutionPlan | undefined> {
  const pool = getPool();
  const res = await pool.query("SELECT plan FROM execution_plans WHERE user_id = $1 AND plan_id = $2", [userId, planId]);
  const row = res.rows[0] as { plan: ExecutionPlan } | undefined;
  return row?.plan;
}

export async function listPlans(userId: string, accountId: string): Promise<ExecutionPlan[]> {
  const pool = getPool();
  const res = await pool.query("SELECT plan FROM execution_plans WHERE user_id = $1 AND account_id = $2 ORDER BY created_at DESC", [userId, accountId]);
  return (res.rows as { plan: ExecutionPlan }[]).map((r) => r.plan);
}
