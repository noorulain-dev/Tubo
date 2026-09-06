import type { Approval, ExecutionResult, PolicyContext, PolicyEvaluation, ProposedAction, ReconciliationFinding, SemanticState } from "./core.js";
import type { ExecutionGap } from "./core.js";
import type { AgentActivityItem, ProposalRevision, ProposalStatus, ProposalView, RunView } from "./types.js";

export interface StoredProposal {
  id: string;
  action: ProposedAction;
  originalAction: ProposedAction;
  revisions: ProposalRevision[];
  policy: PolicyEvaluation;
  status: ProposalStatus;
  approval?: Approval;
  execution?: ExecutionResult;
}

export interface StoredRun {
  id: string;
  mode: RunView["mode"];
  status: RunView["status"];
  accountId?: string;
  createdAt: string;
  semantic: SemanticState | null;
  semanticValid: boolean;
  semanticErrors: string[];
  findings: ReconciliationFinding[];
  gaps: ExecutionGap[];
  proposals: StoredProposal[];
  activity: AgentActivityItem[];
  policyContext: PolicyContext;
  error?: string;
}

export interface InMemoryStore {
  runs: Map<string, StoredRun>;
  proposals: Map<string, { proposal: StoredProposal; runId: string }>;
}

export function createStore(): InMemoryStore {
  return { runs: new Map(), proposals: new Map() };
}

export function toProposalView(p: StoredProposal): ProposalView {
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

export function toRunView(r: StoredRun): RunView {
  return {
    id: r.id,
    mode: r.mode,
    status: r.status,
    accountId: r.accountId,
    createdAt: r.createdAt,
    semantic: r.semantic,
    semanticValid: r.semanticValid,
    semanticErrors: r.semanticErrors,
    findings: r.findings,
    gaps: r.gaps,
    proposals: r.proposals.map(toProposalView),
    activity: r.activity,
    error: r.error,
  };
}
