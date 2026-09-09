# From Scattered Customer Signals to Trusted Revenue State

How I built Tubo, a Revenue Execution OS, during a five-day applied AI sprint.

---

## Executive Summary

**Whose workflow changed?** Luis, a Customer Success Manager who runs back-to-back
client meetings.

**What recurring workflow?** Maintaining accurate operational state after every
customer interaction — reconciling what the customer said against CRM, email,
tasks and commercial state before acting.

**What did I build?** Tubo, a Revenue Execution OS that extracts meaning from a
conversation, retrieves the operational context needed to validate it, reconciles
the two under explicit source authority, and gates every consequential action
behind deterministic policy and human approval.

**How did I prove improvement?** A frozen 14-use-case AI/system evaluation
(12/14), a stable repeated run, a bounded-retrieval architecture comparison, zero
safety violations, and verbatim pilot feedback from Luis.

---

## The User

Luis Mussa is a Customer Success Manager. His real, unedited pilot feedback:

> "You really did something with this product here"

> "Tubo caught the little things I often miss after taking back to back client
> meetings and my brain is fried"

Those two lines are the problem statement compressed. The recurring failure was
not note-taking — it was that after a day of meetings, the little things (a
dropped follow-up, a stale stage, a mismatched billing state) slip because no
single system holds the truth and no one has the energy to re-derive it by hand.

---

## The Existing Workflow

Before Tubo, Luis's post-meeting process was a manual cross-tool sweep:

| Step | What happened |
|---|---|
| **Trigger** | a meeting or customer email ends |
| **Input** | transcript/notes, held in memory or a doc |
| **Judgment** | which commitments matter, who owns them, when |
| **Tools** | meeting notes → HubSpot → task list → Gmail → billing portal |
| **Approval** | his own judgment, no audit trail |
| **Output** | new tasks, a stage change, a draft — or a missed one |
| **Exceptions** | "did I already send that?" · "is the billing actually live?" |

The cost was context switching and re-checking: the manual baseline models this as
roughly 7–12 meaningful touches and 3–6 context switches per interaction, with the
highest-touch case being the messy multi-action one.

---

## The Bottleneck: Operational State Drift

Meeting-summary generation was **not** the real problem. Summaries answer "what
was said." They do not answer "does reality match?"

The real problem is drift:

- customer promises change,
- tasks become stale or duplicated,
- CRM state disagrees with what was said,
- an email may already have been sent,
- commercial state outranks CRM assumptions (a deal sitting in "Trial" while the
  customer is actually paying).

Four systems disagree within a day, and a decision gets made from whichever one was
opened. That is operational state drift — and it is a reconciliation problem, not a
generation problem.

---

## Baseline

The committed manual baseline (`research/baseline-runs.csv`) models three
representative scenarios for a skilled operator:

| Scenario | Active seconds | Touches | Context switches | Systems |
|---|---|---|---|---|
| Simple post-call commitment | 180 | 7 | 3 | 2 |
| Messy multi-action interaction | 420 | 12 | 6 | 4 |
| Commercial-state reconciliation | 300 | 9 | 5 | 2 |

The commercial case is the instructive one: the operator has to *remember* to check
billing, not just CRM — and the manual baseline credits zero task or email output,
only a single CRM correction.

---

## Scope

What made the five-day cut: semantic extraction, bounded read-only investigation,
source-aware reconciliation, execution-gap detection, deterministic policy, human
approval, allowlisted execution, durable background ingestion, and a frozen
evaluation harness. Everything else was cut.

## Non-Goals

Replacing HubSpot. Autonomous email sending (draft-only). Unrestricted CRM
mutation. Commanding Fireflies to join meetings. A generic workflow builder.
Enterprise multi-user RBAC. These exclusions were architectural, not cosmetic.

---

## The Key Design Decision

### The LLM should reason about meaning, not own authority.

This is the decision everything else followed from, and I made it before writing
the first line of the pipeline.

- **The AI** may *understand* an interaction, *retrieve* relevant context,
  *compare* it, *reconcile* it, and *propose* actions.
- **The deterministic system** must *validate* structure, *apply source authority*,
  *apply policy*, *enforce approval*, *execute* allowlisted actions, and *audit*
  every step.
- **The human** *resolves ambiguity* and *approves consequential action*.

Concretely: the model can recommend "mark this deal Closed Won," but it cannot do
so. Only the deterministic policy engine decides whether Closed Won is even
eligible (authoritative active commercial state + deal not already closed), and
only a human approval then authorizes it. The model is the most expressive
component in the system and the least privileged — and that inversion is the whole
point. It is why a wrong model output becomes a blocked/reviewed output instead of
a wrong external write.

---

## Architecture

The pipeline is semantic extraction → bounded investigation → reconciliation → gap
detection → policy → approval → execution, with a durable worker for background
ingestion. The full diagram lives in
[`docs/architecture.md`](architecture.md).

## Why Bounded Retrieval

The agent retrieves a small authoritative baseline (deal + tasks) and fetches
commercial/Gmail only on signal — never "retrieve everything." The architecture
comparison (`docs/architecture-comparison-final.md`) shows bounded retrieval
matches retrieve-all on final correctness (12/14) while cutting unnecessary tool
calls from 10 to 4 and average calls from 8.0 to 3.75, and producing far fewer
missing-context cases (1 vs 8). At equal quality, it is cheaper, faster, and more
precise about what it actually needs.

## Source Authority

Different systems are authoritative for different facts, and a weaker source can
never overwrite a stronger one: conversation is evidence for intent; HubSpot is
authoritative for CRM/deal/task state; Gmail for what was actually sent; the
commercial context for subscription/payment truth. A customer's "we intend to
subscribe" never sets `subscription_status = active` — only the commercial provider
does.

## Human-in-the-Loop

Consequential actions surface as proposals with an explicit approval step
(approve / edit / reject), and **Missing Context Resolution** lets a human answer a
gap from candidates derived from real data. That answer is recorded as
human-supplied context with provenance — never rewritten as model-derived evidence,
so "the model saw this" and "a human told us this" stay distinguishable in the
audit trail.

## Meeting Automation

Google Calendar supplies meeting context; a persistent background worker checks
eligible meetings for corresponding Fireflies output. When Fireflies has already
processed a meeting, Tubo ingests the available transcript/notes, extracts
participants, correlates them to HubSpot accounts, and runs the same reconciliation
pipeline — no manual paste required. **Tubo consumes Fireflies output; it does not
command Fireflies to join meetings.** Manual pasted notes remain a first-class
fallback.

---

## Integrations

HubSpot (CRM + commercial context), Gmail (evidence + drafts, no send), Google
Calendar (meeting context), Fireflies (read-only transcripts), commercial context
(subscription truth), the OpenAI model provider (gpt-6-astra via the Responses
API), Postgres (durable state + job queue), and the background worker.

---

## Failure-Driven Development

I treated failures as the primary input to the build. The ones that mattered:

- **An invalid early evaluator measured the wrong semantic path.** The first harness
  used a keyword/regex stand-in and scored 3/14. It measured plumbing, not the
  model. *Decision:* throw it away and rebuild against the real semantic
  interpreter + retrieval pipeline. *Result:* a measurement that actually tracked
  the system.
- **A model/provider endpoint assumption was wrong.** A tool reported a model as
  unavailable; verifying directly showed otherwise, changing the model decision and
  the cost profile. *Result:* gpt-6-astra selected on evidence, not assumption.
- **Semantic and retrieval failures.** Ambiguous owners/dates were classified
  `missing` and tentative language was promoted to commitments; retrieval recall
  sat at 0.792. *Decision:* harden the five-bucket semantic contract and make
  retrieval bounded. *Result:* classification 1.0, owner 1.0, recall 0.972.
- **A stale investigation lifecycle.** Resolved blockers and rejected
  investigations still produced proposals because outcomes never flowed back to
  finding status. *Decision:* wire investigation outcomes into proposal gating and
  add reverse state transitions. *Result:* no spurious proposals.
- **Frozen ground truth was preserved.** Two cases were flagged for human review
  rather than editing the gold labels to pass.
- **Safety gates held throughout.** Across every run — including cases where the
  model recommended an unsafe action — policy blocked it and the executor never ran:
  0 external executions, 0 bypasses, 0 injection escalations.

---

## Evaluation

Final metrics from the committed artifacts (`docs/evaluation-package.md`):

| Metric | Value |
|---|---|
| Official frozen suite (14 use cases) | **12/14** |
| Stability (3× runs) | **12/14 × 3**, zero flips |
| Supplemental lifecycle (8 cases) | **8/8** |
| Classification / owner accuracy | **1.0 / 1.0** |
| Required-context recall | **0.972** |
| External executions / bypasses / injection escalations | **0 / 0 / 0** |

The score is a suite score — 12 of 14 on the frozen set — not a global claim of
perfect accuracy; date accuracy (0.75) remains a measured, acknowledged gap.

---

## Business / User Results

Luis reporting that Tubo "caught the little things I often miss" after back-to-back meetings. 
I keep system-evaluation
measurements and user/workflow outcomes as separate dimensions of evidence rather
than conflating them.

---

## Reliability

Structured Zod-validated outputs, source-tagged retrieval, persistence-backed
idempotency, durable Postgres jobs, bounded retry with timeouts, fail-closed
fallbacks (missing commercial → "missing context", never "not subscribed"), an
append-only audit trail, provider-error normalization, health/readiness endpoints,
human approval gating, and per-user tenant isolation.

---

## External Proof

Real HubSpot/Gmail/Calendar/Fireflies connections are exercised through a synthetic
`[ASSESSMENT]`-tagged test-data layer, and a real HubSpot provisioning CLI was run
against a live portal. A signed end-to-end release ledger (physical task/stage/draft
write verification) is not yet committed — I state that explicitly rather than
implying a pass I cannot point to.

---

## What I Personally Owned

Problem selection, user research, workflow definition, scope, architecture, the
source-authority model, the AI authority boundaries, the human approval policy,
ground truth, evaluation methodology, failure analysis, model/provider decisions,
acceptance criteria, external validation, deployment decisions, and the final
claims. These were my judgment calls; the tools accelerated the execution of them.

---

## AI-Assisted Development

I used AI development tools throughout the sprint to accelerate implementation,
debugging, testing, refactoring and documentation. Their output remained subject to
the same architecture constraints, evaluation, review and rejection as any other
engineering input. DeepSeek handled implementation, debugging, tests and
refactoring; ChatGPT supported architecture exploration, evaluation design, result
review and planning. The architecture, the safety boundaries, the evaluation
method, and the claims were mine.

---

## Results

Tubo turns a scattered set of customer signals into one review-ready, auditable
account state, reconciles it against authoritative sources, and gates every
consequential action behind policy and a human. It passes 12 of 14 frozen use
cases stably, with zero safety violations, and it changed Luis's post-meeting
workflow from a manual cross-tool sweep into a reconciliation-first review.

## Limitations

Google OAuth is restricted to an assessment test-user allowlist. Commercial truth depends on a
connected/configured commercial source. Fireflies ingestion depends on transcripts
Fireflies has already produced. And a signed external-write release ledger is a
gap to close.

## Next Two Weeks

**Week 1:** measure the workflow — instrument interaction-to-review-ready time,
manual touches, proposal acceptance without edit, correction rate, and duplicate
actions prevented against the baseline.

**Week 2:** iterate on evidence — reduce the two failing use cases (implicit
commitment, collective owner), lower date-accuracy errors, and close the external
release ledger.

---

## Closing

The interesting claim in Tubo is not that an LLM reads a conversation. It is that
an LLM can be trusted to *reason* about revenue state precisely because it is not
trusted to *act* on it. Meaning is delegated to the model; authority is reserved
for deterministic systems and the human operator. That is what makes the
execution trustworthy — and that boundary is the thing I am most confident I built
correctly.
