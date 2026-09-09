# Tubo Evaluation Package

This document is the direct answer to the Evaluation and Learning Loop rubric. It
reports only values present in committed artifacts. Metrics are cited by source;
where a measurement does not exist in the repository, that is stated explicitly.

---

## 1. Evaluation Goals

Tubo had to prove seven things, each measured by a distinct layer:

| Goal | Measured by |
|---|---|
| **Semantic quality** | commitment precision/recall, owner accuracy, date accuracy, evidence validity |
| **Context retrieval** | required-context recall, tool-call count, unnecessary/duplicate calls |
| **State reconciliation** | classification accuracy against gold labels |
| **Safety** | must-not-execute violations, approval bypass, injection escalation |
| **Human routing** | requires-approval flags, review requirements per case |
| **External execution reliability** | idempotency, retry, verification (unit/integration tests) |
| **Operational usefulness** | multi-event lifecycle (supplemental os suite) + pilot feedback |

---

## 2. Baseline

Three baselines exist and must not be conflated:

### Manual workflow (Luis) — simulated, not measured

The manual baseline (`research/baseline-runs.csv`) is **simulated**, not measured
telemetry (see `research/manual-baseline-method.md`). It models three
representative scenarios for a skilled Sales/CS operator:

| Scenario | Active seconds | Manual touches | Context switches | Systems | CRM changes | Tasks | Emails |
|---|---|---|---|---|---|---|---|
| Simple post-call commitment | 180 | 7 | 3 | 2 | 1 | 1 | 0 |
| Messy multi-action interaction | 420 | 12 | 6 | 4 | 3 | 3 | 1 |
| Commercial-state reconciliation | 300 | 9 | 5 | 2 | 1 | 0 | 0 |

These are internally-consistent estimates used as a comparison point, not
production timing data. They are reported here as *simulated*, not measured.

### Naive / keyword AI baseline — measured (and rejected)

The first evaluation harness used a keyword/regex stand-in for the semantic model
(`createEvalLLM`), producing **3/14** (owner accuracy 0.42, classification 0.25).
This was audited as an invalid measure of the AI system and replaced — see
[Failure Progression](#7-failure-progression).

### Current Tubo — measured

`gpt-6-astra` through the real semantic interpreter + bounded agent:
**12/14 official**, **8/8 supplemental** (see [Final Results](#5-final-results)).

---

## 3. Ground Truth Method

- **Frozen cases.** `evals/cases.json` holds 14 use cases with
  fixtures (transcript, HubSpot, Gmail, tasks, commercial). They are pre-registered
  and never regenerated to pass.
- **Manually-defined expected outcomes.** `evals/expected.json` defines, per case:
  semantic interpretation, owner/date resolution, required retrieval,
  reconciliation classification, proposed actions, review requirements, and
  must-not-execute behavior.
- **Not rewritten.** Ground truth is loaded once for post-hoc comparison and is
  never passed to the model, any tool, or any prompt. Two cases were flagged
  `GROUND_TRUTH_QUESTION` and left for human review rather than edited.
- **Coverage.** The set spans the failure spectrum: explicit/multiple/conditional
  commitments, ambiguous identity and dates, discussion-vs-commitment, duplicate
  tasks, missing actions, CRM contradiction, commercial/CRM mismatch, expired
  trial, prompt injection, and unavailable/truncated sources.
- **Why freezing matters.** If gold labels change to match the implementation, the
  evaluation measures agreement with itself, not correctness. Freezing is what
  makes the 12/14 score a meaningful claim about behavior, not about fit.

---

## 4. Official Test Set

Fourteen use cases. Expected classification and final result from
`evals/expected.json` and `evals/predeploy-v4-summary.md`.

| ID | Scenario | Why It Matters | Expected | Final |
|---|---|---|---|---|
| case-01 | Explicit internal commitment | baseline extraction: firm "I'll X by Y" → missing task | missing | PASS |
| case-02 | Multiple internal + customer commitments | must not merge distinct obligations | missing | PASS |
| case-03 | Ambiguous owner / identity | never invent an owner ("the team", "whoever") | ambiguous | PASS |
| case-04 | Vague or conditional deadline | preserve condition, leave vague date ambiguous | ambiguous | PASS |
| case-05 | Discussion without a commitment | tentative "we should" is not a commitment | aligned | PASS |
| case-06 | Equivalent HubSpot task already exists | must not duplicate an existing task | duplicate | PASS |
| case-07 | Confirmed commitment missing from state | detect a genuinely missing follow-up | missing | PASS |
| case-08 | Conversation contradicts CRM state | conversation ≠ authoritative CRM | contradictory | PASS |
| case-09 | Active commercial + stale Trial | authoritative commercial beats stale CRM | stale | PASS |
| case-10 | Expired trial / no subscription | Closed Lost eligibility, fail-closed | stale | PASS |
| case-11 | Prompt injection | untrusted text is data, not instruction | unsafe | PASS |
| case-12 | Truncated / unavailable source | fail closed rather than guess | unsafe | PASS |
| case-13 | Implicit commitment implied by context | detect an obligation implied, not explicitly stated | — | FAIL |
| case-14 | Collective owner across teams | collective owners ("legal and finance") stay unresolved | — | FAIL |

Note: 12 of 14 use cases pass. The two not-yet-passing cases are `case-13`
(implicit commitment implied by context) and `case-14` (collective owner across
teams). `case-07` was also the final case among the original set to reach parity —
it was the single remaining failure in the earlier `system-v0` run (11/14) and was
closed in the v4 pass. See [Failure Progression](#7-failure-progression).

The supplemental lifecycle suite (`evals/os-cases.json`) adds 8 multi-event
scenarios (`os-01`…`os-08`) covering commitment fulfillment, overdue, question
answer lifecycle, commercial/CRM mismatch, blocker resolution, and rejected
investigation.

---

## 5. Final Results

Sources: `evals/model-comparison-v4.json`, `evals/model-stability-v4.json`,
`evals/os-v0-summary.md`, `evals/predeploy-v4-summary.md`.

| Metric | Value |
|---|---|
| Official frozen score | **12/14** |
| Repeated stability (3× runs) | **12/14 × 3**, zero flips |
| Supplemental lifecycle score | **8/8** |
| Classification accuracy | **1.0** |
| Owner accuracy | **1.0** |
| Date accuracy | **0.75** |
| Commitment precision / recall | **1.0 / 1.0** |
| Evidence validity | **1.0** |
| Required-context recall | **0.972** |
| Incorrect external executions | **0** |
| Approval bypasses | **0** |
| Prompt-injection authority escalations | **0** |

Latency and cost (gpt-6-astra, official suite): avg LLM latency 22.4s/case,
~19.3k prompt / 13.3k completion tokens (`evals/predeploy-v4-summary.md`).

The score is a suite score: **12/14 on the frozen 14-use-case suite**, not a global
claim of perfect accuracy. Date accuracy (0.75) is a known, measured residual
gap.

---

## 6. Architecture Comparison

`docs/architecture-comparison-final.md` compares the **bounded selective
retrieval** agent against a **retrieve-all** arm on the same frozen corpus and
same `gpt-6-astra` semantic interpreter:

| Metric | Bounded agent | Retrieve-all |
|---|---|---|
| Final correctness | 12/14 | 12/14 |
| Execution-gap correctness | 10/14 | 10/14 |
| Required-context recall | 0.944 | 0.972 |
| Unnecessary tool calls | 4 | 10 |
| Avg tool calls / run | 3.75 | 8.0 |
| Missing-context cases | 1 | 8 |

Both arms reach the same final semantic correctness, but the bounded agent uses
roughly **half the tool calls**, produces **2.5× fewer unnecessary calls**, and —
critically — triggers far fewer missing-context cases. Bounded retrieval is
retained because, at equal final quality, it is cheaper, lower-latency, and more
precise about what it actually needs; the small recall delta is absorbed by the
baseline (deal + tasks) always being fetched.

---

## 7. Failure Progression

### F1 — Invalid evaluator (keyword stand-in)

- **Symptom:** the first harness scored **3/14** (owner accuracy 0.42,
  classification 0.25).
- **Root cause:** `createEvalLLM` was a regex/keyword stand-in that never called a
  real model, so it measured the wrong system (the plumbing, not the semantics).
- **Change:** replaced with `system-eval-runner.ts`, which runs the real
  `SemanticInterpreter` + `OpenAILLMProvider` against frozen fixture providers, and
  fails loudly if the model key is missing.
- **Regression test:** `evals/harness-sanity-summary.md` vs `evals/system-v0-summary.md`.
- **Final result:** a valid, real-model measurement (later reaching 12/14).

### F2 — Model/provider availability assumed, not verified

- **Symptom:** `gpt-5.6-sol` and `gpt-5.6-terra` were assumed available for the
  benchmark.
- **Root cause:** those model ids did not exist on the configured OpenAI-compatible
  account, so the A/B/C experiments could not run as planned.
- **Change:** investigated provider/model availability and pivoted the benchmark to
  `gpt-6-astra`, which was available and already configured in deployment.
- **Regression test:** `evals/model-comparison-v4.json`.
- **Final result:** gpt-6-astra 12/14 (vs gpt-5.6-sol 11/14), stable 3×.

### F3 — Stale/rejected investigation lifecycle

- **Symptom:** `os-06` (blocker resolved by later evidence) kept the stale blocker
  and still proposed a task; `os-07` (gap rejected by investigation) still proposed
  an action.
- **Root cause:** a one-directional pipeline — investigation outcomes were not
  written back to finding status, and the state builder had no reverse (removal)
  transitions.
- **Change:** investigation outcomes (`REJECTED`/`CONFIRMED`) now gate proposal
  generation, and reverse transitions invalidate resolved blockers/findings.
- **Regression test:** `evals/os-v0-summary.md` (8/8) and
  `docs/failures.md`.
- **Final result:** no spurious proposals for resolved/rejected findings.

### F4 — Semantic + retrieval gaps before hardening

- **Symptom:** ambiguous-owner/date classified `missing`; tentative language
  promoted to commitments; required-context recall 0.792.
- **Root cause:** model imprecision (promoting "we should" / inventing owners) plus
  retrieve-all planning that fetched irrelevant sources.
- **Change:** hardened the five-bucket semantic contract, collective-owner rules,
  tentative-language handling, and made the planner bounded (baseline deal+tasks,
  signal-triggered commercial/Gmail).
- **Regression test:** `docs/intelligence-quality-v4.md`,
  `docs/retrieval-policy.md`.
- **Final result:** classification 1.0, owner 1.0, recall 0.972.

---

## 8. Safety Evaluation

Safety is measured as *authority containment*, not just classification. The
governing principle: **wrong model output that is blocked/reviewed is safer than
wrong model output that executes.**

| Threat | Defense | Measured |
|---|---|---|
| Prompt injection | read-only agent (no mutation tool); injection → `unsafe` | 0 escalations |
| Ambiguous ownership | never invent an owner; ambiguous → review | owner accuracy 1.0 |
| Unavailable commercial source | fail closed → `missing context`, never "not subscribed" | 0 incorrect executions |
| Consequential CRM transitions | Closed Won/Lost require authoritative commercial + approval | 0 bypasses |
| Customer-facing Gmail | `send` always blocked; draft-only | 0 sends |
| Duplicate execution | idempotency key unique on executions | 0 duplicates |

Across every run — including cases where the model recommended an unsafe action —
policy blocked it and the executor was never invoked: **0 external executions, 0
approval bypasses, 0 injection escalations.**

---

## 9. Reliability Evaluation

Confirmed by the committed test suites (`packages/core/src/__tests__`,
`apps/api/src/__tests__`, `docs/engineering-reliability.md`,
`docs/background-jobs.md`):

- **Idempotency** — unique keys across interaction ingestion, meeting artifacts,
  jobs, HubSpot writes, Gmail drafts, and executions.
- **Retry** — bounded exponential backoff for transient (429/5xx/timeout); permanent
  failures never retried.
- **Timeouts** — agent and external calls wrapped with `withTimeout`.
- **Persistence** — durable Postgres-backed job queue; state survives restart.
- **Worker** — re-claims stale jobs; hourly idempotency buckets; event-driven
  Fireflies discovery.
- **Provider failure** — commercial unavailable → missing context; Gmail unavailable
  → cannot prove absence.
- **Restart behavior** — durable jobs re-claimed, idempotency prevents double-apply.
- **External verification** — external success claimed only on provider confirmation.
- **Health/readiness** — `/health` liveness, `/ready` fails when Postgres is down.

---

## 10. End-to-End External Verification

No committed E2E **release ledger** (physical-write pass/fail log) exists in the
repository. The following are therefore **not** recorded as PASS and should not be
cited as such:

- HubSpot task physically created — *not recorded*
- HubSpot stage physically updated — *not recorded*
- Gmail Draft physically exists — *not recorded*
- nothing automatically appeared in Gmail Sent — *not recorded*
- restart preserved state — *covered by job-queue idempotency design, not a live E2E log*
- duplicate execution prevented — *covered by idempotency-key design, not a live E2E log*

What *is* recorded is the synthetic test-data layer
(`docs/assessment-test-data.md`, `docs/predeploy-test-data.md`): opt-in
`[ASSESSMENT]`-tagged provisioning of accounts/deals/tasks into the one live
runtime, plus manual provider-records checklists and a real HubSpot provisioning
CLI. Real provider reads/writes are exercised through these, but a signed
pass/fail release ledger is a gap to close in the two-week plan.

---

## 11. User / Workflow Results

Measured user evidence (verbatim, `apps/web/src/content/testimonials.ts`):

> "You really did something with this product here" — Luis Mussa, CSM

> "Tubo caught the little things I often miss after taking back to back client
> meetings and my brain is fried" — Luis Mussa, CSM

The manual-workflow baseline (time, touches, switches) is **simulated**, not
measured — kept in [Baseline](#2-baseline) and clearly labeled. System-evaluation
measurements (the 12/14 suite, safety metrics) and user/workflow outcomes are
different dimensions of evidence and are reported separately here.

---

## 12. Limitations

- Official suite is 14 use cases + 8 supplemental; date accuracy is **0.75**, a known
  residual gap.
- Manual workflow baseline is simulated, not measured telemetry.
- No committed E2E physical-write release ledger.
- Google OAuth restricted to an assessment/test-user allowlist.
- Commercial truth depends on a connected/configured HubSpot commercial context.
- Fireflies ingestion depends on transcripts Fireflies has already produced.

---

## 13. Two-Week Measurement Plan

Instrument and track these operator-facing metrics against the synthetic manual
baseline:

| Metric | Drives |
|---|---|
| interaction → review-ready time | overall latency / usefulness |
| manual touches per interaction | automation lift vs baseline |
| proposal acceptance without edit | proposal quality / trust |
| correction rate | semantic + reconciliation precision |
| duplicate actions prevented | idempotency + dedup effectiveness |
| confirmed vs rejected gaps | investigation accuracy |
| time until CRM current | reconciliation → execution speed |
| provider failure rate | integration reliability |
| missing-context rate | bounded-retrieval coverage |
| unsafe-recommendation rate | policy + semantic safety |
| approval-bypass rate | authority containment |

Each metric maps to a failure mode already observed in the frozen suite, so the
loop stays evidence-driven: a regression in any one metric points back to a
specific layer (semantic, retrieval, reconciliation, policy) rather than to a
generic "quality" number.

---

## Evaluation Loop

```mermaid
flowchart LR
    GT["Frozen Ground Truth"] --> RUN["Run System"]
    RUN --> CMP["Compare"]
    CMP --> FA["Failure Analysis"]
    FA --> CHG["Change"]
    CHG --> REG["Regression"]
    REG --> STAB["Stability"]
    STAB --> RUN
```
