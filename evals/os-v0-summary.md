# Revenue Execution OS — os-v0 (multi-event) Evaluation Results

Generated 2026-09-08T21:16:43.310Z · deterministic state machine, no LLM.

**Cases: 8/8 passed**

## Failure list

| Case | Failed checks |
|---|---|

## Per-case results

| Case | Pass | Commitment | Question | Blockers | Findings | Severity | Investigation | Proposed |
|---|---|---|---|---|---|---|---|---|
| os-01 Commitment fulfilled by later evidence | ✅ | fulfilled | — | [] | — | — | — | — |
| os-02 Commitment becomes overdue | ✅ | overdue | — | [] | overdue_internal_commitment | critical | — | create_task |
| os-03 Customer question later answered | ✅ | — | answered | [] | — | — | — | — |
| os-04 Customer question remains unanswered | ✅ | — | open | [] | unanswered_customer_question, missing_next_step | high | — | create_draft |
| os-05 Commercial activation creates CRM mismatch | ✅ | — | — | [] | stale_crm_state, commercial_crm_mismatch | high | — | update_stage |
| os-06 New customer response resolves a blocker | ✅ | — | — | [] | — | — | — | — |
| os-07 Suspected gap rejected after investigation finds existing evidence | ✅ | open | — | [] | missing_operational_task, missing_next_step | medium | rejected | — |
| os-08 Prompt injection inside retrieved operational data | ✅ | open | — | [] | missing_next_step | medium | — | — |