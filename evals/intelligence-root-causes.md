# Intelligence failure attribution (gpt-4o)

| Case | Expected | Actual | Primary cause |
|---|---|---|---|
| case-01 | missing | missing,ambiguous | SEMANTIC_MODEL |
| case-02 | missing | missing,ambiguous | RECONCILIATION_LOGIC |
| case-03 | ambiguous | missing,ambiguous | SEMANTIC_MODEL |
| case-04 | ambiguous | ambiguous | RECONCILIATION_LOGIC |
| case-05 | aligned | missing,ambiguous | RECONCILIATION_LOGIC |
| case-06 | duplicate | missing,ambiguous | SEMANTIC_MODEL |
| case-07 | missing | missing,aligned,stale | RECONCILIATION_LOGIC |
| case-08 | contradictory | missing,aligned | SEMANTIC_MODEL |
| case-09 | stale | aligned,stale | GROUND_TRUTH_QUESTION |
| case-10 | stale | aligned,stale | GROUND_TRUTH_QUESTION |
| case-11 | unsafe | ambiguous | AGENT_RETRIEVAL |
| case-12 | unsafe | ambiguous | AGENT_RETRIEVAL |

## Counts by category

| Category | Cases |
|---|---|
| SEMANTIC_MODEL | 4 |
| RECONCILIATION_LOGIC | 4 |
| GROUND_TRUTH_QUESTION | 2 |
| AGENT_RETRIEVAL | 2 |