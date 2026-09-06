import { z } from "zod";
import { GapTypeSchema, GapWhatSchema } from "./enums.js";
import { EvidenceSpanSchema } from "./domain.js";
import { OperationalFactSchema, SourceAuthoritySchema } from "./operational.js";

/**
 * The outcome of comparing a semantic claim against authoritative operational
 * state. "classification" is one of the canonical gap types.
 */
export const ReconciliationResultSchema = z.object({
  id: z.string().optional(),
  claimRef: z.string(),
  classification: GapTypeSchema,
  evidence: z.array(EvidenceSpanSchema).default([]),
  sourceAuthority: SourceAuthoritySchema,
  comparedFacts: z.array(OperationalFactSchema).default([]),
  reason: z.string(),
});
export type ReconciliationResult = z.infer<typeof ReconciliationResultSchema>;

export const GAP_SEVERITIES = ["info", "warning", "critical"] as const;
export const GapSeveritySchema = z.enum(GAP_SEVERITIES);
export type GapSeverity = z.infer<typeof GapSeveritySchema>;

/**
 * An actionable execution gap derived from a reconciliation result: what the
 * system should do next.
 */
export const ExecutionGapSchema = z.object({
  id: z.string().optional(),
  reconciliationId: z.string().optional(),
  type: GapTypeSchema,
  what: GapWhatSchema,
  title: z.string(),
  description: z.string(),
  evidence: z.array(EvidenceSpanSchema).default([]),
  severity: GapSeveritySchema.default("warning"),
});
export type ExecutionGap = z.infer<typeof ExecutionGapSchema>;
