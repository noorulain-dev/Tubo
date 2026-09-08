import type { Approval, ExecutionResult, PolicyContext, PolicyEvaluation, ProposedAction, ReconciliationFinding, SemanticState } from "../shared/core.js";
import type { ExecutionGap } from "../shared/core.js";
import type { AgentActivityItem, ProposalRevision, ProposalStatus, ProposalView, RunView } from "../shared/types.js";

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

/**
 * Persistence boundary for runs and proposals, scoped to an owning user.
 * Implementations must enforce that every object is attributable to `userId`
 * and that reads are ownership-checked by the caller (or by the store).
 */
export interface RunStore {
  saveRun(run: StoredRun, userId: string): Promise<void>;
  getRun(runId: string): Promise<{ run: StoredRun; userId: string } | null>;
  listRuns(userId: string): Promise<StoredRun[]>;
  saveProposal(proposal: StoredProposal, runId: string, userId: string): Promise<void>;
  getProposal(proposalId: string): Promise<{ proposal: StoredProposal; runId: string; userId: string } | null>;
}

interface RunRecord {
  run: StoredRun;
  userId: string;
}
interface ProposalRecord {
  proposal: StoredProposal;
  runId: string;
  userId: string;
}

/** In-memory RunStore for sample/test mode. State is lost on process exit. */
export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RunRecord>();
  private readonly proposals = new Map<string, ProposalRecord>();

  async saveRun(run: StoredRun, userId: string): Promise<void> {
    this.runs.set(run.id, { run, userId });
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    return this.runs.get(runId) ?? null;
  }

  async listRuns(userId: string): Promise<StoredRun[]> {
    return [...this.runs.values()].filter((r) => r.userId === userId).map((r) => r.run);
  }

  async saveProposal(proposal: StoredProposal, runId: string, userId: string): Promise<void> {
    this.proposals.set(proposal.id, { proposal, runId, userId });
  }

  async getProposal(proposalId: string): Promise<ProposalRecord | null> {
    return this.proposals.get(proposalId) ?? null;
  }
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
