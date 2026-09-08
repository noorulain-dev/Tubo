# Architecture comparison — bounded agent vs retrieve-all

Generated 2026-09-08T22:29:23.932Z · same real openai/gpt-6-astra semantic interpreter for both arms.

| Metric | Bounded agent | Retrieve-all |
|---|---|---|
| Final correctness | 12/12 | 12/12 |
| Execution-gap correctness | 10/12 | 10/12 |
| Required-context retrieval recall | 0.944 | 0.972 |
| Unnecessary tool calls (total) | 4 | 10 |
| Avg tool calls / run | 3.75 | 8 |
| Total tool calls | 45 | 96 |
| Missing-context cases | 1 | 8 |

**Operational (shared, one LLM call per case):** 206592 ms total LLM latency (17216 ms avg), 19162 prompt / 12936 completion tokens.