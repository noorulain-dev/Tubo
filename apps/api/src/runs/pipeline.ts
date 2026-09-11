import {
  ReasoningAgent,
  type Account,
  type AgentReadContext,
  type AgentToolCall,
  type CommercialState,
  type ContactRecord,
  type DealRecord,
  type EmailThreadRecord,
  type ExecutionRequest,
  type ExecutionResult,
  type NoteRecord,
  type OperationalContext,
  type PolicyAction,
  type PolicyContext,
  type ProposedAction,
  type ReasoningAgentOptions,
  type SemanticInterpreter,
  type TaskRecord,
  detectExecutionGaps,
  evaluateAction,
  reconcile,
  reconcileOperationalState,
} from "../shared/core.js";
import { toRunView, type RunStore, type StoredProposal, type StoredRun } from "./store.js";
import type { ProviderResolver } from "../integrations/provider-resolver.js";
import type { AgentActivityItem, InteractionInput, ProposalStatus, ProposalView, RunView } from "../shared/types.js";
import type { ExecutionPlan } from "../proposals/execution-plans.js";

export interface RunServiceDeps {
  interpreter: SemanticInterpreter;
  resolver: ProviderResolver;
  store: RunStore;
  agentOptions?: ReasoningAgentOptions;
  now?: () => number;
  mode?: "sample" | "integration";
}

function statusForPolicy(action: PolicyAction): ProposalStatus {
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

const TOOL_LABEL: Record<string, string> = {
  resolve_account: "Account resolution",
  get_account_context: "Account context",
  get_contacts: "Contacts",
  get_open_deal: "HubSpot deal",
  get_recent_notes: "Recent notes",
  get_open_tasks: "Open tasks",
  get_email_thread: "Gmail thread",
  check_existing_action: "Existing action check",
  get_commercial_state: "Commercial state",
  get_customer_activity: "Customer activity",
  get_commercial_exception: "Commercial exception",
};

function buildActivity(toolCalls: AgentToolCall[]): AgentActivityItem[] {
  const activity: AgentActivityItem[] = toolCalls.map((tc) => ({
    tool: TOOL_LABEL[tc.toolName] ?? tc.toolName,
    reason: tc.reasonCategory,
    status: tc.ok ? "retrieved" : "failed",
  }));
  if (!toolCalls.some((tc) => tc.toolName === "get_email_thread")) {
    activity.push({ tool: "Gmail", reason: "No email-dependent claim", status: "skipped" });
  }
  return activity;
}

function toOperationalContext(toolCalls: AgentToolCall[]): OperationalContext {
  const ctx: OperationalContext = {
    contacts: [],
    openDeal: null,
    recentNotes: [],
    openTasks: [],
    commercialState: null,
    emailThread: null,
  };
  for (const tc of toolCalls) {
    if (!tc.ok) continue;
    switch (tc.toolName) {
      case "get_contacts":
        ctx.contacts = tc.result as ContactRecord[];
        break;
      case "get_open_deal":
        ctx.openDeal = tc.result as DealRecord | null;
        break;
      case "get_recent_notes":
        ctx.recentNotes = tc.result as NoteRecord[];
        break;
      case "get_open_tasks":
        ctx.openTasks = tc.result as TaskRecord[];
        break;
      case "get_commercial_state":
        ctx.commercialState = tc.result as CommercialState | null;
        break;
      case "get_email_thread":
        ctx.emailThread = tc.result as EmailThreadRecord | null;
        break;
    }
  }
  return ctx;
}

/**
 * Orchestrates a single interaction through the deterministic pipeline and
 * persists every lifecycle stage through a RunStore, scoped to an owning user.
 */
export class RunService {
  constructor(private readonly deps: RunServiceDeps) {}

  /** Resolve the read-only operational context for a user (used by the investigation agent). */
  async resolveReadContext(userId: string): Promise<AgentReadContext> {
    const { readContext } = await this.deps.resolver.resolve(userId);
    return readContext;
  }

  /** List accounts available to the connected source (for a company picker). */
  async listCompanies(userId: string): Promise<Account[]> {
    const { readContext } = await this.deps.resolver.resolve(userId);
    return readContext.crm.listCompanies?.() ?? [];
  }

  async process(input: InteractionInput, userId: string): Promise<RunView> {
    const now = this.deps.now ?? (() => Date.now());
    const runId = `run_${now()}_${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = new Date(now()).toISOString();

    const run: StoredRun = {
      id: runId,
      mode: this.deps.mode ?? "integration",
      status: "processing",
      accountId: input.accountId,
      createdAt,
      semantic: null,
      semanticValid: false,
      semanticErrors: [],
      findings: [],
      gaps: [],
      proposals: [],
      activity: [],
      policyContext: { commercialState: null, openDeal: null },
    };
    await this.deps.store.saveRun(run, userId);

    const interpret = await this.deps.interpreter.interpret({
      text: input.text,
      kind: input.kind,
      truncated: input.truncated,
      participants: input.participants,
      account: input.accountId ? { id: input.accountId, name: input.accountId } : null,
      interactionId: `interaction_${runId}`,
    });

    run.semantic = interpret.state;
    run.semanticValid = interpret.ok;
    run.semanticErrors = interpret.errors;

    if (!interpret.state) {
      run.status = "failed";
      run.error = interpret.errors.join("; ") || "semantic extraction failed";
      await this.deps.store.saveRun(run, userId);
      return toRunView(run);
    }

    const { readContext, executor } = await this.deps.resolver.resolve(userId);

    const agent = new ReasoningAgent(readContext, this.deps.agentOptions);
    const outcome = await agent.run({ state: interpret.state, accountId: input.accountId ?? "unknown", metadata: {} });
    run.activity = buildActivity(outcome.toolCalls);
    const operationalContext = toOperationalContext(outcome.toolCalls);

    const findings = [
      ...reconcile({ state: interpret.state, context: operationalContext }),
      ...reconcileOperationalState(operationalContext),
    ];
    const gaps = detectExecutionGaps(findings);

    const policyContext: PolicyContext = {
      commercialState: operationalContext.commercialState,
      openDeal: operationalContext.openDeal,
    };

    const proposals: StoredProposal[] = [];
    const seen = new Set<string>();
    findings.forEach((f, i) => {
      if (!f.proposedAction) return;
      const action = f.proposedAction as ProposedAction;
      const key = `${action.type}:${action.target}:${JSON.stringify(action.payload)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const policy = evaluateAction(
        { type: action.type, payload: action.payload as Record<string, unknown> | undefined },
        policyContext,
      );
      const proposal: StoredProposal = {
        id: `proposal_${runId}_${i}`,
        action,
        originalAction: { ...action },
        revisions: [],
        policy,
        status: statusForPolicy(policy.action),
      };
      proposals.push(proposal);
      void this.deps.store.saveProposal(proposal, runId, userId);
    });

    run.findings = findings;
    run.gaps = gaps;
    run.proposals = proposals;
    run.policyContext = policyContext;
    run.status = proposals.some((p) => p.status === "pending_approval") ? "needs_review" : "done";

    await this.deps.store.saveRun(run, userId);
    return toRunView(run);
  }

  async getRun(runId: string, userId: string): Promise<RunView | undefined> {
    const rec = await this.deps.store.getRun(runId);
    if (!rec || rec.userId !== userId) return undefined;
    return toRunView(rec.run);
  }

  async listRuns(userId: string): Promise<RunView[]> {
    const runs = await this.deps.store.listRuns(userId);
    return runs.map(toRunView);
  }

  async getProposal(proposalId: string, userId: string): Promise<ProposalView | undefined> {
    const rec = await this.deps.store.getProposal(proposalId);
    if (!rec || rec.userId !== userId) return undefined;
    return this.view(rec.proposal);
  }

  async editProposal(proposalId: string, userId: string, edit: { payload?: Record<string, unknown> }): Promise<ProposalView | undefined> {
    const rec = await this.deps.store.getProposal(proposalId);
    if (!rec || rec.userId !== userId) return undefined;
    const run = (await this.deps.store.getRun(rec.runId))?.run;
    if (!run) return undefined;

    if (edit.payload) {
      rec.proposal.revisions.push({
        id: `rev_${rec.proposal.revisions.length + 1}`,
        payload: edit.payload,
        at: new Date().toISOString(),
        by: "user",
      });
      rec.proposal.action = { ...rec.proposal.action, payload: edit.payload };
    }
    const policy = evaluateAction(
      { type: rec.proposal.action.type, payload: rec.proposal.action.payload as Record<string, unknown> | undefined },
      run.policyContext,
    );
    rec.proposal.policy = policy;
    rec.proposal.status = statusForPolicy(policy.action);
    rec.proposal.approval = undefined;
    await this.deps.store.saveProposal(rec.proposal, rec.runId, userId);
    return this.view(rec.proposal);
  }

  async approveProposal(proposalId: string, userId: string, reviewer: string): Promise<ProposalView | undefined> {
    const rec = await this.deps.store.getProposal(proposalId);
    if (!rec || rec.userId !== userId) return undefined;
    rec.proposal.approval = { decision: "approve", reviewer, decidedAt: new Date().toISOString() };
    rec.proposal.status = "approved";
    await this.deps.store.saveProposal(rec.proposal, rec.runId, userId);
    return this.view(rec.proposal);
  }

  async rejectProposal(proposalId: string, userId: string, reviewer: string): Promise<ProposalView | undefined> {
    const rec = await this.deps.store.getProposal(proposalId);
    if (!rec || rec.userId !== userId) return undefined;
    rec.proposal.approval = { decision: "reject", reviewer, decidedAt: new Date().toISOString() };
    rec.proposal.status = "rejected";
    await this.deps.store.saveProposal(rec.proposal, rec.runId, userId);
    return this.view(rec.proposal);
  }

  async executeProposal(proposalId: string, userId: string): Promise<ProposalView | undefined> {
    const rec = await this.deps.store.getProposal(proposalId);
    if (!rec || rec.userId !== userId) return undefined;
    const run = (await this.deps.store.getRun(rec.runId))?.run;
    if (!run) return undefined;

    const { executor } = await this.deps.resolver.resolve(userId);
    const req: ExecutionRequest = {
      proposal: rec.proposal.action,
      policyContext: run.policyContext,
      approval: rec.proposal.approval,
      runId: rec.runId,
      interactionFingerprint: `fp_${rec.runId}`,
      proposalSignature: `sig_${proposalId}`,
      executionId: `exec_${proposalId}`,
    };
    const result = await executor.execute(req);
    rec.proposal.execution = result;
    rec.proposal.status = result.status === "success" ? "executed" : "failed";
    await this.deps.store.saveProposal(rec.proposal, rec.runId, userId);
    return this.view(rec.proposal);
  }

  /**
   * Execute a single approved execution-plan action through the live executor.
   * Reuses the same ExecutionRequest shape as proposal execution so policy is
   * revalidated immediately before any write.
   */
  async executePlanAction(plan: ExecutionPlan, actionId: string, userId: string, companyId?: string | null): Promise<ExecutionResult> {
    const a = plan.actions.find((x) => x.actionId === actionId);
    if (!a || a.status !== "approved") {
      throw new Error(`Action ${actionId} is not approved and cannot execute.`);
    }
    const { executor } = await this.deps.resolver.resolve(userId);
    const action = companyId
      ? { ...a.action, payload: { ...(a.action.payload ?? {}), companyId } }
      : a.action;
    const req: ExecutionRequest = {
      proposal: action,
      policyContext: plan.policyContext,
      approval: a.approval,
      runId: `plan_${plan.planId}`,
      interactionFingerprint: `fp_${plan.planId}`,
      proposalSignature: `sig_${actionId}`,
      executionId: `exec_${actionId}`,
    };
    return executor.execute(req);
  }

  private view(p: StoredProposal): ProposalView {
    return {
      id: p.id,
      action: p.action,
      originalAction: p.originalAction,
      revisions: p.revisions,
      policy: p.policy,
      status: p.status,
      approval: p.approval,
      execution: p.execution,
    };
  }
}
