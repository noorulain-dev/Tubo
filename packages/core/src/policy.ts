import { z } from "zod";
import {
  ActionTypeSchema,
  ApprovalDecisionSchema,
  ExecutionStatusSchema,
  PolicyDecisionValueSchema,
} from "./enums.js";

export const ProposedActionSchema = z.object({
  id: z.string().optional(),
  gapId: z.string().optional(),
  type: ActionTypeSchema,
  target: z.string(),
  payload: z.unknown(),
  requiresApproval: z.boolean(),
  blocked: z.boolean(),
  reviewReason: z.string().nullable().optional(),
});
export type ProposedAction = z.infer<typeof ProposedActionSchema>;

export const PolicyDecisionSchema = z.object({
  id: z.string().optional(),
  proposalId: z.string().optional(),
  decision: PolicyDecisionValueSchema,
  reasons: z.array(z.string()).default([]),
  allowlisted: z.boolean(),
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const ApprovalSchema = z.object({
  id: z.string().optional(),
  proposalId: z.string().optional(),
  decision: ApprovalDecisionSchema,
  reviewer: z.string(),
  editedPayload: z.unknown().optional(),
  comment: z.string().nullable().optional(),
  decidedAt: z.string(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const ExecutionResultSchema = z.object({
  id: z.string().optional(),
  proposalId: z.string().optional(),
  status: ExecutionStatusSchema,
  idempotencyKey: z.string(),
  externalRef: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  executedAt: z.string().nullable().optional(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
