import type { Participant } from "../domain.js";
import type {
  Commitment,
  ConditionalCommitment,
  EntityReference,
  SemanticState,
} from "../semantic.js";

const TENTATIVE_PATTERN =
  /\b(might|maybe|could|possibly|perhaps|thinking about|should probably|probably)\b/i;

const CONDITIONAL_PATTERN = /\bif\b/i;

export function isTentative(text: string): boolean {
  return TENTATIVE_PATTERN.test(text);
}

export function isConditional(text: string): boolean {
  return CONDITIONAL_PATTERN.test(text);
}

export function extractCondition(text: string): string | null {
  const m = /\bif\b\s+([^,.]+)/i.exec(text);
  return m ? `if ${m[1].trim()}` : null;
}

export interface RulesContext {
  participants?: Participant[];
  account?: { id: string; name: string } | null;
}

export interface RulesResult {
  state: SemanticState;
  corrections: string[];
}

function commitmentText(c: Commitment): string {
  return [c.action, ...c.evidence.map((e) => e.text)].join(" ");
}

/**
 * Deterministic safety-net rules applied AFTER the LLM produces a state:
 *  - tentative confirmed commitments -> candidate
 *  - conditional confirmed commitments -> conditional (condition preserved)
 *  - person entity references resolved to an unknown identity -> ambiguous
 */
export function enforceRules(state: SemanticState, ctx: RulesContext): RulesResult {
  const corrections: string[] = [];
  const confirmed: Commitment[] = [];
  const candidates: Commitment[] = [...state.candidateCommitments];
  const conditional: ConditionalCommitment[] = [...state.conditionalCommitments];

  for (const c of state.confirmedCommitments) {
    const text = commitmentText(c);
    if (isConditional(text)) {
      conditional.push({
        action: c.action,
        condition: extractCondition(text) ?? "unspecified condition",
        owner: c.owner,
        deadline: c.deadline,
        evidence: c.evidence,
        resolution: c.resolution,
      });
      corrections.push(`commitment reclassified as conditional: ${c.action}`);
    } else if (isTentative(text)) {
      candidates.push(c);
      corrections.push(`commitment downgraded to candidate (tentative): ${c.action}`);
    } else {
      confirmed.push(c);
    }
  }

  const knownIds = new Set<string>();
  for (const p of ctx.participants ?? []) {
    if (p.id) knownIds.add(p.id);
    if (p.email) knownIds.add(p.email.toLowerCase());
    if (p.name) knownIds.add(p.name.toLowerCase());
  }
  if (ctx.account) knownIds.add(ctx.account.id);

  const entityReferences: EntityReference[] = state.entityReferences.map((e) => {
    if (e.kind === "person" && e.resolvedId && !knownIds.has(e.resolvedId.toLowerCase())) {
      corrections.push(`person reference resolved to unknown identity -> ambiguous: ${e.text}`);
      return { ...e, resolvedId: null, resolution: "ambiguous" as const };
    }
    return e;
  });

  return {
    state: {
      ...state,
      confirmedCommitments: confirmed,
      candidateCommitments: candidates,
      conditionalCommitments: conditional,
      entityReferences,
    },
    corrections,
  };
}
