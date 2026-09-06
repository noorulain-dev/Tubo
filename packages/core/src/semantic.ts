import { z } from "zod";
import { ResolutionStateSchema } from "./enums.js";
import { EvidenceSpanSchema } from "./domain.js";

export const TEMPORAL_KINDS = ["exact", "relative", "conditional", "ambiguous"] as const;
export const TemporalKindSchema = z.enum(TEMPORAL_KINDS);
export type TemporalKind = z.infer<typeof TemporalKindSchema>;

/**
 * A temporal/deadline expression. "value" is populated only when the date is
 * deterministically resolvable; otherwise "ambiguous"/"conditional" is retained
 * and value stays null (never coerced).
 */
export const TemporalExpressionSchema = z.object({
  id: z.string().optional(),
  text: z.string(),
  kind: TemporalKindSchema,
  value: z.string().nullable().optional(),
  resolution: ResolutionStateSchema,
});
export type TemporalExpression = z.infer<typeof TemporalExpressionSchema>;

export const ENTITY_KINDS = ["person", "company", "system"] as const;
export const EntityKindSchema = z.enum(ENTITY_KINDS);
export type EntityKind = z.infer<typeof EntityKindSchema>;

export const EntityReferenceSchema = z.object({
  id: z.string().optional(),
  text: z.string(),
  kind: EntityKindSchema,
  resolvedId: z.string().nullable().optional(),
  resolution: ResolutionStateSchema,
});
export type EntityReference = z.infer<typeof EntityReferenceSchema>;

export const DecisionSchema = z.object({
  id: z.string().optional(),
  text: z.string(),
  evidence: z.array(EvidenceSpanSchema),
  resolution: ResolutionStateSchema,
  decidedBy: z.string().nullable().optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;

/**
 * A confirmed commitment. Tentative language is expressed separately as a
 * candidate commitment (same shape, different bucket in SemanticState).
 */
export const CommitmentSchema = z.object({
  id: z.string().optional(),
  action: z.string(),
  owner: z.string().nullable().optional(),
  deadline: TemporalExpressionSchema.nullable().optional(),
  evidence: z.array(EvidenceSpanSchema),
  resolution: ResolutionStateSchema,
});
export type Commitment = z.infer<typeof CommitmentSchema>;

/**
 * A commitment whose validity is gated on a condition. The condition is
 * preserved verbatim and is never collapsed into a confirmed commitment.
 */
export const ConditionalCommitmentSchema = z.object({
  id: z.string().optional(),
  action: z.string(),
  condition: z.string(),
  owner: z.string().nullable().optional(),
  deadline: TemporalExpressionSchema.nullable().optional(),
  evidence: z.array(EvidenceSpanSchema),
  resolution: ResolutionStateSchema,
});
export type ConditionalCommitment = z.infer<typeof ConditionalCommitmentSchema>;

export const TASK_CANDIDATE_KINDS = ["internal", "customer"] as const;
export const TaskCandidateKindSchema = z.enum(TASK_CANDIDATE_KINDS);
export type TaskCandidateKind = z.infer<typeof TaskCandidateKindSchema>;

export const TaskCandidateSchema = z.object({
  id: z.string().optional(),
  action: z.string(),
  kind: TaskCandidateKindSchema,
  owner: z.string().nullable().optional(),
  deadline: TemporalExpressionSchema.nullable().optional(),
  evidence: z.array(EvidenceSpanSchema),
  resolution: ResolutionStateSchema,
});
export type TaskCandidate = z.infer<typeof TaskCandidateSchema>;

export const CommercialSignalSchema = z.object({
  id: z.string().optional(),
  kind: z.string(),
  text: z.string(),
  evidence: z.array(EvidenceSpanSchema),
  resolution: ResolutionStateSchema,
});
export type CommercialSignal = z.infer<typeof CommercialSignalSchema>;

/**
 * The validated structured semantic state produced by the interpreter. This is
 * the output contract of the SEMANTIC INTERPRETER stage.
 */
export const SemanticStateSchema = z.object({
  interactionId: z.string(),
  decisions: z.array(DecisionSchema).default([]),
  confirmedCommitments: z.array(CommitmentSchema).default([]),
  candidateCommitments: z.array(CommitmentSchema).default([]),
  conditionalCommitments: z.array(ConditionalCommitmentSchema).default([]),
  taskCandidates: z.array(TaskCandidateSchema).default([]),
  commercialSignals: z.array(CommercialSignalSchema).default([]),
  entityReferences: z.array(EntityReferenceSchema).default([]),
  temporalExpressions: z.array(TemporalExpressionSchema).default([]),
  blockers: z.array(z.string()).default([]),
  evidence: z.array(EvidenceSpanSchema).default([]),
});
export type SemanticState = z.infer<typeof SemanticStateSchema>;
