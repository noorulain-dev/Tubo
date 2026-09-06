import { z } from "zod";

/**
 * Resolution of an owner, identity, date, or claim.
 * "missing_context" signals that required source data was unavailable and the
 * value must NOT be guessed.
 */
export const RESOLUTION_STATES = [
  "resolved",
  "ambiguous",
  "unsupported",
  "conflicting",
  "missing_context",
] as const;
export const ResolutionStateSchema = z.enum(RESOLUTION_STATES);
export type ResolutionState = z.infer<typeof ResolutionStateSchema>;

/**
 * Canonical reconciliation classification / execution gap type.
 */
export const GAP_TYPES = [
  "missing",
  "duplicate",
  "contradictory",
  "stale",
  "ambiguous",
  "unsafe",
  "aligned",
] as const;
export const GapTypeSchema = z.enum(GAP_TYPES);
export type GapType = z.infer<typeof GapTypeSchema>;

/**
 * Which system/source a fact, span, or snapshot originates from.
 */
export const SOURCE_TYPES = [
  "conversation",
  "hubspot",
  "gmail",
  "tasks",
  "commercial",
  "system",
] as const;
export const SourceTypeSchema = z.enum(SOURCE_TYPES);
export type SourceType = z.infer<typeof SourceTypeSchema>;

/**
 * Authority of a fact relative to a fact-type. "authoritative" beats "evidence"
 * for actual-state claims; "derived" is computed, never primary truth.
 */
export const AUTHORITY_LEVELS = ["authoritative", "evidence", "derived"] as const;
export const AuthorityLevelSchema = z.enum(AUTHORITY_LEVELS);
export type AuthorityLevel = z.infer<typeof AuthorityLevelSchema>;

export const PARTICIPANT_ROLES = ["internal", "customer", "unknown", "system"] as const;
export const ParticipantRoleSchema = z.enum(PARTICIPANT_ROLES);
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;

export const INTERACTION_KINDS = ["call", "slack", "note", "email_thread", "meeting"] as const;
export const InteractionKindSchema = z.enum(INTERACTION_KINDS);
export type InteractionKind = z.infer<typeof InteractionKindSchema>;

export const ACTION_TYPES = [
  "create_note",
  "create_task",
  "update_field",
  "update_stage",
  "create_draft",
  "flag_for_review",
  "log_security_event",
  "none",
] as const;
export const ActionTypeSchema = z.enum(ACTION_TYPES);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const POLICY_DECISIONS = ["allow", "block", "require_approval"] as const;
export const PolicyDecisionValueSchema = z.enum(POLICY_DECISIONS);
export type PolicyDecisionValue = z.infer<typeof PolicyDecisionValueSchema>;

export const APPROVAL_DECISIONS = ["approve", "reject", "edit"] as const;
export const ApprovalDecisionSchema = z.enum(APPROVAL_DECISIONS);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const EXECUTION_STATUSES = ["pending", "success", "failed", "skipped"] as const;
export const ExecutionStatusSchema = z.enum(EXECUTION_STATUSES);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const AUDIT_LEVELS = ["info", "warn", "error"] as const;
export const AuditLevelSchema = z.enum(AUDIT_LEVELS);
export type AuditLevel = z.infer<typeof AuditLevelSchema>;

export const RUN_STATUSES = [
  "created",
  "processing",
  "needs_review",
  "done",
  "failed",
] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const GAP_WHAT = ["changed", "missing", "stale", "conflict", "needs_review"] as const;
export const GapWhatSchema = z.enum(GAP_WHAT);
export type GapWhat = z.infer<typeof GapWhatSchema>;
