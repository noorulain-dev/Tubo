import { SemanticStateSchema, type SemanticState } from "../semantic.js";
import type { EvidenceSpan } from "../domain.js";

/**
 * Validate raw LLM output into a SemanticState, injecting the interaction id.
 * Throws (Zod) on schema failure — callers capture this as a schema failure.
 */
export function validateSemanticState(parsed: unknown, interactionId: string): SemanticState {
  return SemanticStateSchema.parse({
    interactionId,
    ...(parsed as Record<string, unknown> | null | undefined),
  });
}

export interface EvidenceIssue {
  field: string;
  reason: string;
  text: string;
}

function collectSpans(state: SemanticState): { field: string; span: EvidenceSpan }[] {
  const out: { field: string; span: EvidenceSpan }[] = [];
  const add = (field: string, spans: EvidenceSpan[]) => {
    for (const s of spans) out.push({ field, span: s });
  };
  for (const d of state.decisions) add("decisions", d.evidence);
  for (const c of state.confirmedCommitments) add("confirmedCommitments", c.evidence);
  for (const c of state.candidateCommitments) add("candidateCommitments", c.evidence);
  for (const c of state.conditionalCommitments) add("conditionalCommitments", c.evidence);
  for (const t of state.taskCandidates) add("taskCandidates", t.evidence);
  for (const s of state.commercialSignals) add("commercialSignals", s.evidence);
  add("evidence", state.evidence);
  return out;
}

/**
 * Validate that every quoted evidence span actually exists verbatim in the
 * interaction text. Returns the list of failing spans (empty == valid).
 */
export function validateEvidence(state: SemanticState, sourceText: string): EvidenceIssue[] {
  const issues: EvidenceIssue[] = [];
  for (const { field, span } of collectSpans(state)) {
    if (!span.text || span.text.trim().length === 0) {
      issues.push({ field, reason: "empty evidence text", text: "" });
    } else if (!sourceText.includes(span.text)) {
      issues.push({ field, reason: "evidence not found in interaction", text: span.text });
    }
  }
  return issues;
}
