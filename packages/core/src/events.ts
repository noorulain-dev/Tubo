/**
 * Canonical audit event names for the Revenue Execution OS pipeline. Every
 * stage emits these well-known names so the audit trail is queryable and
 * consistent.
 */
export const EVENTS = {
  INTERACTION_RECEIVED: "interaction_received",
  SEMANTIC_EXTRACTION_COMPLETED: "semantic_extraction_completed",
  AGENT_STARTED: "agent_started",
  AGENT_TOOL_COMPLETED: "agent_tool_completed",
  RECONCILIATION_COMPLETED: "reconciliation_completed",
  EXECUTION_GAP_DETECTED: "execution_gap_detected",
  POLICY_EVALUATED: "policy_evaluated",
  PROPOSAL_CREATED: "proposal_created",
  PROPOSAL_EDITED: "proposal_edited",
  PROPOSAL_APPROVED: "proposal_approved",
  PROPOSAL_REJECTED: "proposal_rejected",
  EXECUTION_STARTED: "execution_started",
  CRM_WRITE_SUCCESS: "crm_write_success",
  CRM_WRITE_FAILURE: "crm_write_failure",
  GMAIL_DRAFT_SUCCESS: "gmail_draft_success",
  GMAIL_DRAFT_FAILURE: "gmail_draft_failure",
  DUPLICATE_EXECUTION_PREVENTED: "duplicate_execution_prevented",
  RUN_COMPLETED: "run_completed",
} as const;

export type AuditEventName = (typeof EVENTS)[keyof typeof EVENTS];
