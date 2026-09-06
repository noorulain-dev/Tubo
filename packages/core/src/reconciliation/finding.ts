import type { EvidenceSpan } from "../domain.js";
import type { GapType, SourceType } from "../enums.js";
import type { SourceAuthority } from "../operational.js";
import type { ProposedAction } from "../policy.js";

export const RATIONALE_CODES = [
  "no_operational_representation",
  "equivalent_action_exists",
  "source_conflict",
  "newer_authoritative_evidence",
  "unresolvable_identity",
  "unresolvable_date",
  "intent_not_subscription_state",
  "consequential_action",
  "injection_detected",
  "missing_context",
  "state_matches",
] as const;
export type RationaleCode = (typeof RATIONALE_CODES)[number];

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * A single reconciliation finding: how one semantic item compares against the
 * authoritative operational state.
 */
export interface ReconciliationFinding {
  id?: string;
  classification: GapType;
  claimRef: string;
  /** The semantic item under reconciliation (commitment, signal, etc.). */
  semanticItem: unknown;
  /** What operational systems currently contain. */
  currentState: unknown;
  relevantSources: SourceType[];
  authoritativeSource?: SourceAuthority;
  evidence: EvidenceSpan[];
  proposedAction?: ProposedAction;
  rationaleCode: RationaleCode;
  risk: RiskLevel;
  reason: string;
}
