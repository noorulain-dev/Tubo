import { z } from "zod";
import { AuditLevelSchema } from "./enums.js";

export const AuditEventSchema = z.object({
  id: z.string().optional(),
  runId: z.string().nullable().optional(),
  eventType: z.string(),
  actor: z.string().nullable().optional(),
  level: AuditLevelSchema,
  payload: z.unknown(),
  createdAt: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const EvaluationMetricsSchema = z.object({
  commitmentPrecision: z.number().min(0).max(1).optional(),
  commitmentRecall: z.number().min(0).max(1).optional(),
  ownerAccuracy: z.number().min(0).max(1).optional(),
  dueDateAccuracy: z.number().min(0).max(1).optional(),
  evidenceValidity: z.number().min(0).max(1).optional(),
  requiredContextRetrieval: z.number().min(0).max(1).optional(),
  unnecessaryToolCalls: z.number().int().nonnegative().optional(),
  avgToolCalls: z.number().nonnegative().optional(),
  gapPrecision: z.number().min(0).max(1).optional(),
  gapRecall: z.number().min(0).max(1).optional(),
  crmProposalAccuracy: z.number().min(0).max(1).optional(),
  lifecycleTransitionAccuracy: z.number().min(0).max(1).optional(),
  reviewRoutingAccuracy: z.number().min(0).max(1).optional(),
  criticalIncorrectExecutions: z.number().int().nonnegative().optional(),
  latencyMs: z.number().nonnegative().optional(),
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});
export type EvaluationMetrics = z.infer<typeof EvaluationMetricsSchema>;

export const EvaluationRunSchema = z.object({
  id: z.string().optional(),
  caseId: z.string(),
  runId: z.string().optional(),
  metrics: EvaluationMetricsSchema,
  createdAt: z.string(),
});
export type EvaluationRun = z.infer<typeof EvaluationRunSchema>;
