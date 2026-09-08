# Architecture comparison — bounded agent vs retrieve-all

Generated 2026-09-08T18:57:48.788Z · same real openai/gpt-4o semantic interpreter for both arms.

| Metric | Bounded agent | Retrieve-all |
|---|---|---|
| Final correctness | 4/12 | 5/12 |
| Execution-gap correctness | 4/12 | 5/12 |
| Required-context retrieval recall | 0.792 | 0.972 |
| Unnecessary tool calls (total) | 1 | 10 |
| Avg tool calls / run | 2.917 | 8 |
| Total tool calls | 35 | 96 |
| Missing-context cases | 0 | 8 |

**Operational (shared, one LLM call per case):** 81995 ms total LLM latency (6832.917 ms avg), 12058 prompt / 5358 completion tokens.

## Tradeoff

- **Retrieve-all** wins on correctness (5/12 vs 4/12) and recall (0.972 vs 0.792), but at
  2.7× the tool calls (96 vs 35), 10 unnecessary calls (vs 1), and 8 wasted reads into
  a commercial provider that is unavailable for those cases. At production scale this is
  N+1 provider load against live systems for near-zero gain.
- **Bounded agent** approx. halves+ the retrieval cost (2.9 tools/run) and avoids touching
  an unavailable/irrelevant provider, but drops one case's required context (recall 0.792),
  costing one classification.
- Both arms are dominated by semantic-interpretation + reconciliation correctness (the
  shared LLM), not retrieval: the two strategies differ by exactly one case. The bounded
  agent is the right default at scale; the one recall gap is a planner-refinement
  opportunity (retrieve the missing source when a specific signal is present), not a
  reason to abandon selective retrieval.

No production architecture change was made for cosmetics; the only finding is the
bounded planner's single recall miss, a genuine (small) defect to note, not benchmark
manipulation.