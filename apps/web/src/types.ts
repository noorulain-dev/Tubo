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
  mode?: "sample" | "live";
}

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Command Center / Account Intelligence (Step 57–59)
// ---------------------------------------------------------------------------

export type Severity = "low" | "medium" | "high" | "critical";

export interface TopFinding {
  type: string;
  title: string;
  severity: Severity;
}

export interface AccountRow {
  accountId: string;
  identity: { name?: string; companyId?: string; contactId?: string; dealId?: string } | null;
  stage: string | null;
  commercial: string | null;
  highestSeverity: Severity | null;
  topFinding: TopFinding | null;
  openCommitments: number;
  openQuestions: number;
  blockerCount: number;
  blocked: boolean;
  lastMeaningfulEventAt: string | null;
  pendingCount: number;
  lastReviewedAt: string | null;
  updatedAt: string | null;
  isAssessment: boolean;
}

export interface Finding {
  findingId: string;
  accountId: string;
  type: string;
  severity: Severity;
  title: string;
  description: string;
  evidence: string[];
  sourceReferences: string[];
  signals: { signal: string; value: string | number }[];
  needsInvestigation: boolean;
  status: "open" | "resolved";
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface CommitmentState {
  id: string;
  type: string;
  description: string;
  owner: string | null;
  ownerResolution: string | null;
  dueDate: string | null;
  dueDateText: string | null;
  dueDateResolution: string | null;
  condition: string | null;
  status: string;
  relatedTaskIds: string[];
  relatedEmailIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface QuestionState {
  id: string;
  question: string;
  status: string;
  answer: { text: string; source: string; reference: string | null } | null;
  askedAt: string;
  answeredAt: string | null;
}

export interface ChangeSet {
  stage: { before: string | null; after: string | null } | null;
  commercial: { before: string | null; after: string | null } | null;
  newCommitments: string[];
  resolvedCommitments: string[];
  newQuestions: string[];
  answeredQuestions: string[];
  newBlockers: string[];
  resolvedBlockers: string[];
  eventsSince: number;
}

export interface AccountSnapshot {
  identity: { name?: string; companyId?: string; contactId?: string; dealId?: string } | null;
  stage: string | null;
  commercial: { status?: string; provenance?: string | null } | null;
  decisions: unknown[];
  commitments: CommitmentState[];
  questions: QuestionState[];
  blockers: string[];
  nextSteps: string[];
  risks: string[];
  recentEvents: { eventType: string; occurredAt: string }[];
  executionGaps: string[];
  unavailableSources: string[];
  lastReviewed: string | null;
  lastSourceRefresh: string | null;
  version: number;
}

export interface InvestigationTraceStep {
  tool: string;
  reasonCategory: string;
  source: string | null;
  status: "success" | "missing_context" | "error" | "cache";
  factualResult: string;
  evidenceReference: string | null;
  latencyMs: number;
}

export type InvestigationOutcome = "confirmed" | "rejected" | "ambiguous" | "missing_context";

export interface InvestigationResult {
  findingId: string;
  outcome: InvestigationOutcome;
  trace: InvestigationTraceStep[];
  budget: { used: number; max: number };
  startedAt: string;
  finishedAt: string;
}

export interface ExecutionPlanAction {
  actionId: string;
  action: ProposedAction;
  policy: PolicyEvaluation;
  status: string;
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
  createdAt: string;
}

export interface AccountDetail {
  accountId: string;
  snapshot: AccountSnapshot;
  changes: ChangeSet;
  findings: Finding[];
  latestInvestigation: InvestigationResult | null;
  plans: ExecutionPlan[];
  recentEvents: { eventId: string; eventType: string; occurredAt: string; source: string | null }[];
  lastReviewedAt: string | null;
}
