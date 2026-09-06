import { z } from "zod";
import {
  InteractionKindSchema,
  ParticipantRoleSchema,
  ResolutionStateSchema,
  SourceTypeSchema,
} from "./enums.js";

/**
 * A concrete span of source text that backs a claim. Every non-trivial semantic
 * claim MUST carry at least one evidence span.
 */
export const EvidenceSpanSchema = z.object({
  source: SourceTypeSchema,
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  text: z.string(),
});
export type EvidenceSpan = z.infer<typeof EvidenceSpanSchema>;

export const ParticipantSchema = z.object({
  id: z.string().optional(),
  role: ParticipantRoleSchema,
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  identity: ResolutionStateSchema,
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const AccountSchema = z.object({
  id: z.string(),
  externalId: z.string().optional(),
  domain: z.string().nullable().optional(),
  name: z.string(),
  source: SourceTypeSchema,
});
export type Account = z.infer<typeof AccountSchema>;

export const InteractionSchema = z.object({
  id: z.string(),
  accountId: z.string().optional(),
  kind: InteractionKindSchema,
  rawText: z.string(),
  participants: z.array(ParticipantSchema),
  truncated: z.boolean().default(false),
  receivedAt: z.string(),
});
export type Interaction = z.infer<typeof InteractionSchema>;
