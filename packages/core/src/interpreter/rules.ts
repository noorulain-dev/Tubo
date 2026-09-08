import type { Participant } from "../domain.js";
import type {
  Commitment,
  CommercialSignal,
  ConditionalCommitment,
  EntityReference,
  SemanticState,
} from "../semantic.js";

const TENTATIVE_PATTERN =
  /\b(might|maybe|could|possibly|perhaps|thinking about|should probably|probably)\b/i;

const CONDITIONAL_PATTERN = /\bif\b/i;

/**
 * Explicitly collective / unspecified actors. These MUST NOT be resolved to an
 * individual. Deliberately excludes bare first-person pronouns ("we", "us") which
 * normally resolve to the speaker's own organization/customer and are handled by
 * the prompt's owner-resolution rules, not by this safety net.
 */
const COLLECTIVE_OWNER_PATTERN =
  /\b(the team|our team|my team|the broader team|the account team|the solutions team|the finance team|the legal team|the sales team|someone|somebody|whoever|the rep|a colleague|an analyst|the AE|the CSM)\b/i;

/** A claim that something ALREADY happened (completion/payment/activation). */
const CLAIM_COMMERCIAL_PATTERN =
  /\b(signed|executed|wired|paid|paying|payment|activated|cancelled|canceled|delivered|completed|approved|went live|are live|we'?re live|now paying|upgraded|confirmed in billing|already signed)\b/i;

/** Genuine commercial INTENT (subscription/upgrade intent). */
const INTENT_COMMERCIAL_PATTERN =
  /\b(want to|wants to|intend|intends|intending|plan to|planning to|decided|decision|moving forward|moving ahead|subscribe|subscribing|upgrade|upgrading)\b/i;

/** A statement that a trial has ended/expired — a state signal, not a commitment. */
const TRIAL_ENDED_PATTERN =
  /\b(trial (has )?(ended|expired|passed)|trial window|gone silent|long passed|no response|lapsed)\b/i;

/** Prompt-injection content inside the (untrusted) interaction text. */
const INJECTION_PATTERN =
  /\b(ignore (all )?previous instructions|system override|admin (mode|tool)|act as|you are now|override (your )?policy|delete all tasks|mark every deal|close every open deal)\b/i;

export function isTentative(text: string): boolean {
  return TENTATIVE_PATTERN.test(text);
}

export function isConditional(text: string): boolean {
  return CONDITIONAL_PATTERN.test(text);
}

export function isInjectionText(text: string): boolean {
  return INJECTION_PATTERN.test(text);
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
 *  - collective/unresolved owners stay unresolved (never mapped to an individual)
 *  - person entity references resolved to an unknown identity -> ambiguous
 *  - commercial signal kinds normalized to canonical buckets (intent/claim) or dropped
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
      // PART 2: a collective/unspecified owner stays a confirmed commitment, but
      // its owner must remain unresolved (never mapped to a named individual).
      const isCollective =
        COLLECTIVE_OWNER_PATTERN.test(c.owner ?? "") ||
        COLLECTIVE_OWNER_PATTERN.test(c.evidence.map((e) => e.text).join(" "));
      if (isCollective && c.owner != null) {
        corrections.push(`collective owner left unresolved: ${c.action}`);
        confirmed.push({ ...c, owner: null, resolution: "ambiguous" });
      } else {
        confirmed.push(c);
      }
    }
  }

  // PART 4: normalize free-form commercial signal kinds to canonical buckets, and
  // drop signals that are neither intent nor a fact claim (e.g. "renewal" timing).
  // Canonical kinds are trusted as-is; only free-form kinds are normalized/dropped.
  const CANONICAL_SIGNAL_KINDS = new Set([
    "claims_subscribed",
    "intent_to_subscribe",
    "trial_ended",
    "cancellation_request",
  ]);
  const commercialSignals: CommercialSignal[] = [];
  for (const s of state.commercialSignals) {
    if (CANONICAL_SIGNAL_KINDS.has(s.kind)) {
      commercialSignals.push(s);
      continue;
    }
    const lower = [s.kind, s.text, ...s.evidence.map((e) => e.text)].join(" ").toLowerCase();
    if (TRIAL_ENDED_PATTERN.test(lower)) {
      commercialSignals.push({ ...s, kind: "trial_ended" });
      corrections.push(`commercial signal normalized to trial state: ${s.kind}`);
    } else if (CLAIM_COMMERCIAL_PATTERN.test(lower)) {
      commercialSignals.push({ ...s, kind: "claims_subscribed" });
      corrections.push(`commercial signal normalized to claim: ${s.kind}`);
    } else if (INTENT_COMMERCIAL_PATTERN.test(lower)) {
      commercialSignals.push({ ...s, kind: "intent_to_subscribe" });
      corrections.push(`commercial signal normalized to intent: ${s.kind}`);
    } else {
      corrections.push(`commercial signal dropped (not intent/claim): ${s.kind}`);
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
      commercialSignals,
      entityReferences,
    },
    corrections,
  };
}
