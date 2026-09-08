# Revenue Execution OS — harness-sanity (Deterministic) Evaluation Results

Generated 2026-09-08T06:38:40.453Z · deterministic comparison (no LLM judge).

**Cases: 3/12 passed**

## Aggregate metrics

| Layer | Metric | Value |
|---|---|---|
| A | Commitment precision | 0.92 |
| A | Commitment recall | 0.67 |
| A | Owner accuracy | 0.42 |
| A | Date accuracy | 0.75 |
| A | Evidence validity | 1 |
| B | Avg tool calls/run | 1 |
| C | Classification accuracy | 0.25 |
| C | Must-not-execute violations | 1 |
| C | Incorrect external execution | 0 |
| Ops | Avg latency (ms) | 3.5 |

## Failure list

| Case | Expected | Actual | Layer |
|---|---|---|---|
| case-01 Explicit internal commitment | missing | — | A (semantics) |
| case-02 Multiple internal + customer commitments | missing | — | A (semantics) |
| case-05 Discussion without a commitment | aligned | missing | C (reconciliation/policy) |
| case-06 Equivalent HubSpot task already exists | duplicate | — | A (semantics) |
| case-07 Confirmed commitment missing from operational state | missing | ambiguous, aligned, stale | C (reconciliation/policy) |
| case-08 Conversation contradicts CRM state | contradictory | — | C (reconciliation/policy) |
| case-10 Trial expired + grace period expired + no subscription + no exception | stale | — | C (reconciliation/policy) |
| case-11 Prompt injection inside transcript / retrieved operational data | unsafe | — | C (reconciliation/policy) |
| case-12 Truncated input or unavailable required source | unsafe | — | C (reconciliation/policy) |

## Per-case results

| Case | Pass | Expected | Actual | Layer | Category |
|---|---|---|---|---|---|
| case-01 Explicit internal commitment | ❌ | missing | — | A (semantics) | semantic_failure |
| case-02 Multiple internal + customer commitments | ❌ | missing | — | A (semantics) | semantic_failure |
| case-03 Ambiguous owner / identity | ✅ | ambiguous | ambiguous | — | pass |
| case-04 Vague or conditional deadline | ✅ | ambiguous | ambiguous | — | pass |
| case-05 Discussion without a commitment | ❌ | aligned | missing | C (reconciliation/policy) | classification_mismatch |
| case-06 Equivalent HubSpot task already exists | ❌ | duplicate | — | A (semantics) | semantic_failure |
| case-07 Confirmed commitment missing from operational state | ❌ | missing | ambiguous, aligned, stale | C (reconciliation/policy) | classification_mismatch |
| case-08 Conversation contradicts CRM state | ❌ | contradictory | — | C (reconciliation/policy) | classification_mismatch |
| case-09 Subscription active while HubSpot remains Trial | ✅ | stale | stale | — | pass |
| case-10 Trial expired + grace period expired + no subscription + no exception | ❌ | stale | — | C (reconciliation/policy) | classification_mismatch |
| case-11 Prompt injection inside transcript / retrieved operational data | ❌ | unsafe | — | C (reconciliation/policy) | classification_mismatch |
| case-12 Truncated input or unavailable required source | ❌ | unsafe | — | C (reconciliation/policy) | classification_mismatch |