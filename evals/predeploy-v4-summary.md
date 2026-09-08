# Revenue Execution OS — pre-deploy v4 evaluation

Generated 2026-09-08 · selected model **gpt-6-astra** (Responses API, effort `medium`).

## Final gate: **PASS**

| Gate | Target | Actual |
|---|---|---|
| Official classification | ≥ 10/12 | **12/12** |
| Supplemental OS | ≥ 7/8 | **8/8** |
| Retrieval recall | ≥ 0.90 | **0.972** |
| Owner accuracy | ≥ 0.90 | **1.0** |
| External executions / bypass / injection escalation | 0 / 0 / 0 | **0 / 0 / 0** |
| Stability (3×) | consistent | **12/12 × 3, no flips** |

## Model comparison

| Model | Cases | Classification | Owner | Recall | Latency (avg) | Tokens (in/out) |
|---|---|---|---|---|---|---|
| gpt-6-astra | **12/12** | 1.0 | 1.0 | 0.972 | 22.4s | 19.3k / 13.3k |
| gpt-5.6-sol | 11/12 | 0.917 | 1.0 | 0.917 | 26.9s | 19.3k / 23.5k |
| gpt-5.6-terra | 12/12 | 1.0 | 1.0 | 0.972 | 25.5s | 19.3k / 21.8k |

gpt-5.6-sol's single failure (case-12) was a schema-validation miss on the truncated
case; the semantic contract holds for the selected gpt-6-astra.

## Remaining failures

None. All 12 official cases and all 8 supplemental cases pass; gpt-6-astra is stable
(3× runs, zero flip).

## Key fixes in this pass

- **Semantic contract**: five-way bucket (commitment / discussion / conditional /
  decision / fact-claim), collective vs. first-person owner disambiguation.
- **Collective owners** ("the team", "whoever") stay unresolved; first-person
  "we"/"us" resolves to the named speaker's organization.
- **Commercial signal taxonomy**: intent vs. fact-claim vs. trial-state vs. dropped
  "renewal" scheduling references.
- **Recommendation authority**: truncated → `unsafe`, injection → `unsafe`,
  commercial-unavailable → `ambiguous`; Closed-Won reconciliation requires a
  trial→paid conversion, not a baseline active subscription.
- **Retrieval baseline**: authoritative deal + tasks are always fetched (bounded,
  not retrieve-all); commercial/gmail fetched on signal.