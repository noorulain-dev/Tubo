import type { InteractionKind } from "../enums.js";
import type { Participant } from "../domain.js";
import type { SemanticState } from "../semantic.js";

export interface InterpretInput {
  /** Raw interaction text (transcript / notes / email body). Untrusted data. */
  text: string;
  kind: InteractionKind;
  truncated?: boolean;
  /** Explicitly known participants/account — the only identity context supplied. */
  participants?: Participant[];
  account?: { id: string; name: string } | null;
  interactionId?: string;
}

export interface InterpretationObservability {
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  schemaValid: boolean;
  evidenceValid: boolean;
}

export interface InterpretResult {
  state: SemanticState | null;
  ok: boolean;
  /** Schema/evidence validation errors. */
  errors: string[];
  /** Deterministic rule corrections applied (e.g., downgraded tentative commitment). */
  corrections: string[];
  observability: InterpretationObservability;
}
