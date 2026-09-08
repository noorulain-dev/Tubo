# Semantic Contract (v4)

The Semantic Interpreter turns an untrusted interaction into a validated
[`SemanticState`](../packages/core/src/semantic.ts) that the rest of the system
reconciles against authoritative sources. This document records the hardened
extraction contract introduced in Step 70.1D.

## Five-way classification

Every material statement is assigned to exactly one bucket — never cross-contaminated:

| Bucket | `SemanticState` field | Trigger |
|---|---|---|
| Confirmed commitment | `confirmedCommitments` | explicit, unconditional obligation |
| Discussion / suggestion | *(no bucket)* | "should probably", "maybe", "circle back", "figure out later" |
| Conditional commitment | `conditionalCommitments` | "if X, then I'll Y" (condition preserved verbatim) |
| Decision | `decisions` | "we've made the decision", "moving forward" |
| Commercial fact claim | `commercialSignals` (kind `claims_subscribed`) | "signed/executed/paid/wired/activated/cancelled/sent/delivered/completed/approved/went live" |

## Collective vs. first-person owner (PART 2)

- **Collective / unspecified** actors — "the team", "our team", "someone from
  finance", "whoever", "the rep" — produce a *confirmed* commitment but with
  `owner = null` and `resolution = "ambiguous"`. They are **never** mapped to a
  named participant, the logged-in user, or the account.
- **First-person "we"/"us"** spoken by a *named* individual resolves to that
  person's own organization (customer for a customer speaker, internal team for
  an internal speaker). Only genuinely unspecified actors are nulled.

## Tentative language (PART 3)

`should` / `could` / `might` / `maybe` / `possibly` / `perhaps` are **not**
keyword rejections. The full sentence is interpreted:

- "Sarah **might** send it" → candidate commitment, `resolution = "ambiguous"`.
- A bare discussion of a future idea → no commitment at all.

The deterministic safety net ([`enforceRules`](../packages/core/src/interpreter/rules.ts))
still downgrades tentative/conditional language that the LLM mis-buckets.

## Fact claims vs. conclusions (PART 4)

Completion verbs (`signed`, `paid`, `wired`, `activated`, `cancelled`, `sent`,
`delivered`, `completed`) are extracted as **signals**, not conclusions. The
reconciliation layer compares them against authoritative sources and may
classify `contradictory`.

Canonical signal kinds are trusted as-is; free-form kinds are normalized
deterministically:

| Free-form kind (`text` evidence) | Normalized kind |
|---|---|
| "signed/payment/live/upgraded/now paying" | `claims_subscribed` |
| "want to / intend / moving forward / upgrade" | `intent_to_subscribe` |
| "trial ended / window passed / gone silent" | `trial_ended` |
| "renewal" scheduling reference | **dropped** (not a signal) |

## Resolution / fail-closed (PART 5)

- `truncated` interaction → classified `unsafe` (missing context).
- `injected` interaction → classified `unsafe` (treated as data, no action).
- Commercial state unavailable (not truncated) → `ambiguous` (cannot determine).
- A recommendation never auto-implies an action; the deterministic policy engine
  remains the sole authority for execution approval.