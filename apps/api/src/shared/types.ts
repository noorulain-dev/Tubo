import { z } from "zod";
import {
  InteractionKindSchema,
  ParticipantSchema,
  type Approval,
  type ExecutionGap,
  type ExecutionResult,
  type PolicyEvaluation,
  type ProposedAction,
  type ReconciliationFinding,
  type SemanticState,
} from "./core.js";

export const InteractionInputSchema = z.object({
  text: z.string().min(1),
  kind: InteractionKindSchema,
  accountId: z.string().optional(),
  participants: z.array(ParticipantSchema).optional(),
  truncated: z.boolean().optional(),
  mode: z.enum(["sample", "live"]).optional(),
});
export type InteractionInput = z.infer<typeof InteractionInputSchema>;

export const ProposalEditSchema = z.object({
  payload: z.record(z.unknown()).optional(),
});
export type ProposalEdit = z.infer<typeof ProposalEditSchema>;

export const PROPOSAL_STATUSES = [
  "pending_approval",
  "ready",
  "approved",
  "rejected",
  "executed",
  "failed",
  "blocked",
  "informational",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** A server-side revision of a proposal, created on every explicit edit. */
export interface ProposalRevision {
  id: string;
  payload: unknown;
  at: string;
  by: string;
}

export interface ProposalView {
  id: string;
  action: ProposedAction;
  /** The original AI proposal, preserved for audit even after edits. */
  originalAction: ProposedAction;
  revisions: ProposalRevision[];
  policy: PolicyEvaluation;
  status: ProposalStatus;
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
  mode: "sample" | "integration";
  status: "created" | "processing" | "needs_review" | "done" | "failed";
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

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type {
  Approval,
  ExecutionGap,
  ExecutionResult,
  PolicyEvaluation,
  ProposedAction,
  ReconciliationFinding,
  SemanticState,
};
