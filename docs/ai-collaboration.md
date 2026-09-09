# AI Collaboration Note

AI accelerated implementation. Engineering judgment, system boundaries,
evaluation and final acceptance remained my responsibility.

---

## What I Owned

I led with the decisions, not the typing. The things that determined whether Tubo
was correct, safe and shippable were mine:

- **Problem selection** — choosing operational-state drift (reconciliation) over
  the easier, more obvious "meeting notes to tasks" framing.
- **User research** — grounding the problem in a real operator's (Luis's) recurring
  workflow and verbatim feedback.
- **Workflow mapping** — the trigger → input → judgment → tools → approval →
  output → exceptions model of the existing cross-tool process.
- **Scope** — deciding what made a five-day cut and what was deliberately excluded.
- **Architecture** — the semantic → retrieval → reconciliation → policy → approval →
  execution pipeline.
- **Source authority** — which system is authoritative for which fact class, and
  that a weaker source never overwrites a stronger one.
- **AI authority limits** — that the model understands, retrieves, compares and
  proposes, but never approves, executes or overrides policy.
- **Human review boundaries** — what requires approval, and that resolving a gap is
  not the same as approving an action.
- **Ground truth** — writing and freezing the 14-use-case evaluation corpus and its
  expected outcomes before tuning.
- **Evaluation design** — the layered metrics (semantic, retrieval, reconciliation,
  safety) and the stability/architecture-comparison runs.
- **Failure analysis** — attributing each failure to a specific layer rather than a
  generic "quality" number.
- **Model/provider selection** — choosing gpt-6-astra on measured results, not
  assumption.
- **Acceptance criteria** — the frozen gate and the zero-safety-violation bar, set
  before the results existed.
- **External E2E verification** — the synthetic `[ASSESSMENT]` provisioning and
  live HubSpot checks.
- **Deployment and final claims** — what I am willing to assert about the system.

---

## AI Tools Used

I used two tools, each for the work it was good at.

- **DeepSeek** — implementation assistance, debugging, tests, refactoring, and
  documentation.
- **ChatGPT** — architecture exploration, product/system design discussion,
  evaluation design, failure and result review, and planning.

No other AI tooling materially shaped the build.

---

## What I Delegated to AI

- Implementation drafts and boilerplate.
- Test generation and code navigation.
- Debugging hypotheses.
- Documentation drafting.
- UI implementation assistance.

None of these were accepted unexamined.

---

## How AI Output Was Verified

AI-generated code and analysis were held to the same bar as anything I wrote by
hand:

- Compilation and typecheck.
- The unit/integration test suites in `packages/core` and `apps/api`.
- The frozen 14-use-case evaluation, run repeatedly for stability.
- Manual end-to-end exercise of the live app.
- External HubSpot/Gmail verification through the synthetic test-data layer.
- Direct code inspection against the architecture constraints.
- Ground-truth comparison that never sees model output.

A claim or change that could not clear these did not ship, regardless of its
source.

---

## Important AI Results I Rejected or Corrected

**1. An early evaluator that did not measure the real system.** The first harness
used a keyword/regex stand-in for the semantic model and produced a score that
looked meaningful but exercised the wrong path. I rejected that result as an
invalid quality measure and rebuilt the harness against the production semantic
interpreter and retrieval pipeline.

**2. A model-availability assumption.** An initial conclusion about which models
were reachable was not accepted at face value. I tested the actual provider
endpoint directly; the corrected finding changed the benchmark to gpt-6-astra and,
with it, the cost and quality profile of the system.

**3. Benchmark-specific fixes.** Where a failure could have been made to pass with
a brittle case-specific rule, I fixed it in the general logic — or left it failing
and documented it — rather than patch the score. Frozen ground truth was never
rewritten to make the implementation look better.

**4. Safety over a higher pass rate.** Recommendations that lacked authoritative
evidence — a Closed Won proposal without active commercial state, an email send, a
prompt-injected instruction — remained blocked or routed to review rather than
executed. A higher score with weaker safety would not have been an improvement.

---

## Core Boundary

The AI was responsible for understanding, investigating, reconciling and
proposing. Deterministic systems were responsible for authority, policy and
consequences.

---

AI accelerated implementation. I remained responsible for what the system was
allowed to believe, what evidence counted as authoritative, how quality was
measured, when automation was unsafe, and whether the final system was ready to
ship.
