// Frontend contract types mirroring the backend API (apps/api/src/types.ts).
// The backend is the source of truth; these are the JSON shapes it returns.

export type Mode = "sample" | "integration";
export type RunStatus = "created" | "processing" | "needs_review" | "done" | "failed";
export type Classification =
  | "missing"
  | "duplicate"
  | "contradictory"
  | "stale"
  | "ambiguous"
  | "unsafe"
  | "aligned";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface EvidenceSpan {
  source: string;
  start: number;
  end: number;
  text: string;
}

export interface Deadline {
  text: string;
  value?: string | null;
  resolution: string;
}

export interface Commitment {
  action: string;
  owner?: string | null;
  deadline?: Deadline | null;
  evidence: EvidenceSpan[];
  resolution: string;
}

export interface CommercialSignal {
  kind: string;
  text: string;
  evidence: EvidenceSpan[];
  resolution: string;
}

export interface SemanticState {
  interactionId: string;
  decisions: unknown[];
  confirmedCommitments: Commitment[];
  candidateCommitments: Commitment[];
  conditionalCommitments: (Commitment & { condition: string })[];
  taskCandidates: (Commitment & { kind: string })[];
  commercialSignals: CommercialSignal[];
  blockers: string[];
}

export interface ProposedAction {
  type: string;
  target: string;
  payload: unknown;
  requiresApproval: boolean;
  blocked: boolean;
  reviewReason?: string | null;
}

export interface PolicyEvaluation {
  action: "informational" | "safe_to_prepare" | "approval_required" | "blocked";
  ruleId: string;
  reasonCode: string;
  risk: RiskLevel;
  requiresApproval: boolean;
  allowlisted: boolean;
  reasons: string[];
  inputs: unknown;
}

export interface ReconciliationFinding {
  classification: Classification;
  claimRef: string;
  semanticItem: unknown;
  currentState: unknown;
  relevantSources: string[];
  authoritativeSource?: { source: string; authority: string };
  evidence: EvidenceSpan[];
  proposedAction?: ProposedAction;
  rationaleCode: string;
  risk: RiskLevel;
  reason: string;
}

export interface ExecutionGap {
  type: Classification;
  what: string;
  title: string;
  description: string;
  evidence: EvidenceSpan[];
  severity: string;
}

export interface ProposalRevision {
  id: string;
  payload: unknown;
  at: string;
  by: string;
}

export interface Approval {
  decision: "approve" | "reject" | "edit";
  reviewer: string;
  decidedAt: string;
}

export interface ExecutionResult {
  status: "pending" | "success" | "failed" | "skipped";
  idempotencyKey: string;
  externalRef?: string | null;
  error?: string | null;
  executedAt?: string | null;
}

export interface ProposalView {
  id: string;
  action: ProposedAction;
  originalAction: ProposedAction;
  revisions: ProposalRevision[];
  policy: PolicyEvaluation;
  status: string;
  approval?: Approval;
  execution?: ExecutionResult;
}

export interface AgentActivityItem {
  tool: string;
  reason: string;
  status: "retrieved" | "skipped" | "failed";
}

export interface RunView {
  id: string;
  mode: Mode;
  status: RunStatus;
  accountId?: string;
  createdAt: string;
  semantic: SemanticState | null;
  semanticValid: boolean;
  semanticErrors: string[];
  findings: ReconciliationFinding[];
  gaps: ExecutionGap[];
  proposals: ProposalView[];
  activity: AgentActivityItem[];
  error?: string;
}

export interface InteractionInput {
  text: string;
  kind: string;
  accountId?: string;
  participants?: unknown[];
  truncated?: boolean;
}

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}
