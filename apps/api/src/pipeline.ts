import {
  ReasoningAgent,
  type AgentReadContext,
  type AgentToolCall,
  type AuditService,
  type CommercialState,
  type ContactRecord,
  type DealRecord,
  type EmailThreadRecord,
  type Executor,
  type ExecutionRequest,
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
} from "./core.js";
import { createStore, toRunView, type InMemoryStore, type StoredProposal, type StoredRun } from "./store.js";
import type { AgentActivityItem, InteractionInput, ProposalStatus, ProposalView, RunView } from "./types.js";

export interface RunServiceDeps {
  interpreter: SemanticInterpreter;
  readContext: AgentReadContext;
  executor: Executor;
  audit: AuditService;
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

export class RunService {
  private readonly store: InMemoryStore;

  constructor(private readonly deps: RunServiceDeps) {
    this.store = createStore();
  }

  async process(input: InteractionInput): Promise<RunView> {
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
    this.store.runs.set(runId, run);

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
      return toRunView(run);
    }

    const agent = new ReasoningAgent(this.deps.readContext, this.deps.agentOptions);
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
      this.store.proposals.set(proposal.id, { proposal, runId });
    });

    run.findings = findings;
    run.gaps = gaps;
    run.proposals = proposals;
    run.policyContext = policyContext;
    run.status = proposals.some((p) => p.status === "pending_approval") ? "needs_review" : "done";

    return toRunView(run);
  }

  getRun(runId: string): RunView | undefined {
    const run = this.store.runs.get(runId);
    return run ? toRunView(run) : undefined;
  }

  listRuns(): RunView[] {
    return [...this.store.runs.values()].map(toRunView);
  }

  getProposal(proposalId: string): ProposalView | undefined {
    const record = this.store.proposals.get(proposalId);
    return record ? this.view(record.proposal) : undefined;
  }

  editProposal(proposalId: string, edit: { payload?: Record<string, unknown> }): ProposalView | undefined {
    const record = this.store.proposals.get(proposalId);
    if (!record) return undefined;
    const run = this.store.runs.get(record.runId);
    if (!run) return undefined;

    if (edit.payload) {
      record.proposal.revisions.push({
        id: `rev_${record.proposal.revisions.length + 1}`,
        payload: edit.payload,
        at: new Date().toISOString(),
        by: "user",
      });
      record.proposal.action = { ...record.proposal.action, payload: edit.payload };
    }
    const policy = evaluateAction(
      { type: record.proposal.action.type, payload: record.proposal.action.payload as Record<string, unknown> | undefined },
      run.policyContext,
    );
    record.proposal.policy = policy;
    record.proposal.status = statusForPolicy(policy.action);
    record.proposal.approval = undefined;
    return this.view(record.proposal);
  }

  approveProposal(proposalId: string, reviewer: string): ProposalView | undefined {
    const record = this.store.proposals.get(proposalId);
    if (!record) return undefined;
    record.proposal.approval = { decision: "approve", reviewer, decidedAt: new Date().toISOString() };
    record.proposal.status = "approved";
    return this.view(record.proposal);
  }

  rejectProposal(proposalId: string, reviewer: string): ProposalView | undefined {
    const record = this.store.proposals.get(proposalId);
    if (!record) return undefined;
    record.proposal.approval = { decision: "reject", reviewer, decidedAt: new Date().toISOString() };
    record.proposal.status = "rejected";
    return this.view(record.proposal);
  }

  async executeProposal(proposalId: string): Promise<ProposalView | undefined> {
    const record = this.store.proposals.get(proposalId);
    if (!record) return undefined;
    const run = this.store.runs.get(record.runId);
    if (!run) return undefined;

    const req: ExecutionRequest = {
      proposal: record.proposal.action,
      policyContext: run.policyContext,
      approval: record.proposal.approval,
      runId: record.runId,
      interactionFingerprint: `fp_${record.runId}`,
      proposalSignature: `sig_${proposalId}`,
      executionId: `exec_${proposalId}`,
    };
    const result = await this.deps.executor.execute(req);
    record.proposal.execution = result;
    record.proposal.status = result.status === "success" ? "executed" : "failed";
    return this.view(record.proposal);
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
