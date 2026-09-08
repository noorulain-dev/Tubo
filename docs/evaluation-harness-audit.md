# Evaluation Harness Audit

Why the first 12-case run (3/12) is a **deterministic harness sanity run**, not a
measurement of the final AI system, and how the corrected `system-v0` harness
measures the real stack.

## 1. What `createEvalLLM` is

[`eval-runner.ts`](../../apps/api/src/eval-runner.ts) defines `createEvalLLM`, a
**keyword/regex stand-in** `LLMProvider`. It never calls a real model; it scans the
`transcript.turns` text with regular expressions for:

- conditional commitments (`if … I'll …`)
- confirmed commitments (`I'll … by …`)
- commercial signals (`subscribed`, `intent to subscribe`, `trial ended`)

and returns a hand-built JSON blob as if the model had produced a `SemanticState`.

## 2. Why it was originally introduced

- To validate the **evaluation plumbing** end-to-end (fixture loading, retrieval
  agent, reconciliation, gap detection, policy, output files) without needing a
  live LLM key, and to be deterministic/reproducible/instant.
- To run in CI without network or cost.

## 3. Which layers it bypasses/approximates

| Layer | Keyword harness | Real system |
|-------|-----------------|-------------|
| Semantic interpretation | **Approximated** — regex, no model | **Real** `SemanticInterpreter` → production LLM → validated `SemanticState` |
| Bounded agent / tools | Real (`ReasoningAgent` + read tools) | Real (same) |
| Reconciliation / gaps | Real (`reconcile`, `detectExecutionGaps`) | Real (same) |
| Policy | Real (`evaluateAction`) | Real (same) |
| External executor | Not invoked | Not invoked (side-effect free) |

So the keyword harness **bypasses only the semantic layer** (Layer A). Its Layer B
and Layer C metrics run the real deterministic components, but on top of a
non-model semantic input — which is exactly why its Layer A numbers (owner accuracy
0.42, classification accuracy 0.25) must not be read as production-model quality.

## 4. Why 3/12 is not production quality

The 3/12 result reflects the **keyword extractor's** failure to recover the
semantic state the real LLM would produce, not the product's reasoning. It is a
**plumbing sanity check**, not an intelligence measurement.

## 5. Corrected `system-v0` harness

[`system-eval-runner.ts`](../../apps/api/src/system-eval-runner.ts) runs the **real**
production path:

```
Interaction → SemanticInterpreter(OpenAILLMProvider, configured model)
           → bounded ReasoningAgent → fixture-backed tool registry
           → reconciliation → execution-gap detection → deterministic policy
```

- **Real** `SemanticInterpreter` + configured model (provider/model recorded in
  metadata as `semantic_provider`/`semantic_model`/`agent_provider`/`agent_model`).
- **Deterministic frozen fixture providers** (HubSpot CRM, Gmail, commercial
  context) derived from each `cases.json` case — no network, no real data, no
  mutation.
- **No executor** is invoked; `executed` is always 0. Proposals and policy
  decisions are generated, and execution eligibility is evaluated, but external
  side effects stop before execution.
- **Fails loudly** if the real LLM key is missing/invalid (`isPlaceholderToken`
  gate, exit code 2) — never silently falls back to `createEvalLLM`.
- `evals/expected.json` is loaded once and used **only** for post-hoc comparison;
  it is never passed to the interpreter, the agent, any tool, or any prompt.

## 6. Keyword vs real system

| Dimension | Keyword stand-in (`harness-sanity`) | Real system (`system-v0`) |
|-----------|--------------------------------------|---------------------------|
| Semantic path | regex `createEvalLLM` | `SemanticInterpreter` + `OpenAILLMProvider` |
| Agent path | real | real |
| Provider behavior | frozen fixtures | frozen fixtures (same) |
| Side effects | none (no executor) | none (no executor) |
| Latency meaning | ~0 (no model) | real LLM + run latency |
| Token meaning | synthetic estimates | real API usage |
| Demonstrates | plumbing + deterministic layers | actual AI reasoning quality |

## 7. Artifacts

- Keyword sanity run: `evals/harness-sanity-results.json`, `evals/harness-sanity-summary.md`, `evals/harness-sanity-summary.csv`.
- Real system run: `evals/system-v0-results.json`, `evals/system-v0-summary.md`, `evals/system-v0-results.csv`.
- `evals/cases.json`, `evals/expected.json`, `evals/baseline-results.json` are read-only and unchanged.
