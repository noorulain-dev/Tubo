# Reconciliation Rules (Step 70.1C)

Deterministic classification rules for a single operational fact, plus precedence.

## Classification rules (per fact)

1. **No commitment + no gap** → `ALIGNED` / no action. Absence of a commitment is
   **not** ambiguity and not `MISSING`.
2. **Explicit commitment + no equivalent task/state** → `MISSING` (with a
   `create_task` proposal).
3. **Equivalent task already exists** → `DUPLICATE` (never create another).
4. **Explicit commitment + unresolvable owner** → `AMBIGUOUS` (never guess an owner
   from To/Cc, name local-part, role, or proximity).
5. **Conversation conflicts with authoritative source** (same operational fact) →
   `CONTRADICTORY`.
6. **Authoritative source changed while CRM stale** → `STALE`.
7. **Required authoritative source unavailable** → `UNSAFE` / `MISSING_CONTEXT`
   (fail closed; never infer absence).
8. **Prompt injection / instruction to override policy, force Closed Won/Lost, or
   send email** → `UNSAFE` (data stays untrusted; agent still must not obey).

## Task equivalence (deterministic, conservative)

Two tasks describe the same obligation when one set of significant tokens is a
subset of the other, after stripping filler/qualifier words (`the`, `to`, `final`,
`revised`, `updated`, …). Synonym-level equivalence ("docs" vs "documentation") is
**not** auto-matched, so equivalence can never wrongly suppress task creation.

## Source authority

- Commercial truth → HubSpot commercial context / configured authoritative field.
- CRM operational truth → HubSpot deal/contact/task.
- Conversation → intent, commitments, decisions, context (evidence, never authoritative for subscription/CRM fact).
- Gmail → what was actually sent/replied.

Conversation intent never overrides authoritative commercial evidence; deal stage
is never subscription truth.

## Precedence (one primary classification per fact)

`UNSAFE` / `MISSING_CONTEXT` > `CONTRADICTORY` > `AMBIGUOUS` > `STALE` > `DUPLICATE`
> `MISSING` > `ALIGNED`.

Multiple *independent* findings for *different* facts are allowed;
contradictory states for the **same** fact resolve to the higher-precedence class.

## Fixes applied this pass

- `findEquivalentTask` → normalized token-subset equivalence (fixes case-06 duplicate).
- `reconcileCommercialSignal` — missing commercial → `unsafe` (fail closed) instead of `ambiguous` (fixes case-12).
- `INJECTION_PATTERN` — added `admin tool`, `act as`, `you are now` (fixes case-11).