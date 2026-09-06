import { z } from "zod";
import {
  AuthorityLevelSchema,
  SourceTypeSchema,
  type AuthorityLevel,
  type SourceType,
} from "./enums.js";

/**
 * Fact-type -> authority binding. The same source string is authoritative for
 * some facts and mere evidence for others; this object records the binding used
 * for a specific retrieved fact.
 */
export const SourceAuthoritySchema = z.object({
  source: SourceTypeSchema,
  authority: AuthorityLevelSchema,
});
export type SourceAuthority = z.infer<typeof SourceAuthoritySchema>;

/**
 * A single retrieved operational fact tagged with its source and authority.
 */
export const OperationalFactSchema = z.object({
  id: z.string().optional(),
  factType: z.string(),
  source: SourceTypeSchema,
  authority: AuthorityLevelSchema,
  value: z.unknown(),
  externalRef: z.string().nullable().optional(),
  retrievedAt: z.string(),
});
export type OperationalFact = z.infer<typeof OperationalFactSchema>;

/**
 * An immutable capture of a source's state at retrieval time. Used to compare
 * "then vs now" and to audit what the agent actually observed.
 */
export const SourceSnapshotSchema = z.object({
  id: z.string().optional(),
  source: SourceTypeSchema,
  authority: AuthorityLevelSchema,
  capturedAt: z.string(),
  payload: z.unknown(),
});
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;

/**
 * Canonical fact-type -> authoritative source bindings. This encodes the
 * "source authority" rule: actual state facts resolve to their authoritative
 * source, while intent/commitments are evidence-only.
 */
export const FACT_AUTHORITY: Record<
  string,
  { source: SourceType; authority: AuthorityLevel }
> = {
  subscription_state: { source: "commercial", authority: "authoritative" },
  trial_state: { source: "commercial", authority: "authoritative" },
  payment_state: { source: "commercial", authority: "authoritative" },
  commercial_exception: { source: "commercial", authority: "authoritative" },
  crm_stage: { source: "hubspot", authority: "authoritative" },
  crm_owner: { source: "hubspot", authority: "authoritative" },
  crm_notes: { source: "hubspot", authority: "authoritative" },
  task_state: { source: "tasks", authority: "authoritative" },
  sent_communication: { source: "gmail", authority: "authoritative" },
  stated_intent: { source: "conversation", authority: "evidence" },
  commitment: { source: "conversation", authority: "evidence" },
  decision: { source: "conversation", authority: "evidence" },
};
