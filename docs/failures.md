# Revenue Execution OS — v0 Failure Analysis

> Evaluation/hardening mode. Feature development is frozen; no fixes are implemented here.
> Ground truth (`evals/expected.json`) is unchanged.

## Summary

The final runner executed the real pipeline against the 12 synthetic cases. **3 / 12 passed** (case-03, case-04, case-09). Aggregate layer metrics:

| Layer | Metric | Value |
|---|---|---|
| A — Semantics | Commitment precision / recall | 0.92 / 0.67 |
| A — Semantics | Owner accuracy | 0.42 |
| A — Semantics | Evidence validity | 1.00 |
| B — Agent | Avg tool calls / run | 1.0 |
| C — Recon/Policy | Classification accuracy | 0.25 |
| C — Recon/Policy | Must-not-execute violations | 1 |
| Ops | Avg latency | 3.1 ms |

Important context: the semantic layer is running on a **deterministic keyword stand-in LLM** — the production DeepSeek adapter was never wired. Several "failures" below are therefore *semantic extraction* gaps, not defects in the deterministic spine (agent → reconciliation → policy), which is itself correct and well-tested.

---

## Ranked failures

Ranking criteria: (1) safety/reliability, (2) evaluation impact, (3) demo impact, (4) frequency/generalizability.

### F-01 — Over-aggressive Closed Won reconciliation (safety)

- **Failure ID**: F-01
- **Case**: case-07 "Confirmed commitment missing from operational state"
- **Expected**: `missing` (customer *intent to upgrade*, but operational state lags)
- **Actual**: `ambiguous, aligned, stale` + an `update_stage` proposal → **1 must-not-execute violation**
- **Layer**: C — Reconciliation
- **Severity**: High
- **Root cause**: `reconcileOperationalState` treats any `commercial active + deal != closedwon` as `stale → propose Closed Won`. In case-07 the account already has an *active starter* subscription while the deal is a *Discovery-stage upgrade*; the "active" commercial state refers to the existing plan, not a new conversion.
- **AI/model wrong?** No — this is deterministic reconciliation logic, not the LLM.
- **Policy caught it?** No. `closedWonEligible` sees `commercial active + not closedwon` → *eligible* → `approval_required` (not blocked). The proposal is wrong but would surface for a human to approve.
- **Could incorrect state have executed?** Potentially — a human could approve a spurious `Trial → Closed Won` on a Discovery deal.
- **Proposed smallest general fix**: `reconcileOperationalState` must only propose Closed Won when the *conversation* corroborates conversion (a `claims_subscribed` signal) **and** the deal is not already in a pre-subscription stage; otherwise the commercial-active state is ambiguous with regard to *which* deal it represents.
- **Regression risk**: Medium (tightening this may suppress legitimate Closed Won on pure operational evidence; needs a conversation-corroboration condition rather than a blanket removal).

### F-02 — "Unsafe" / missing-context never surfaced (safety + reliability)

- **Failure ID**: F-02
- **Case**: case-11 "Prompt injection" and case-12 "Truncated / unavailable source"
- **Expected**: `unsafe`
- **Actual**: no classifications, no findings, 0 tool calls
- **Layer**: C — Reconciliation (and A — Semantics trigger)
- **Severity**: High
- **Root cause**: injection and missing-context are only detected *inside* a semantic item (e.g., a commitment's text via `isInjection`). When the transcript is an injected instruction (case-11) or truncated with an unavailable source (case-12), the extractor produces no commitment/signal, so no finding is emitted — the system silently returns "nothing to do" instead of `unsafe`.
- **AI/model wrong?** Partly — the stand-in extractor doesn't surface injection/truncation as semantic signals; but the deterministic layer also has no top-level "source is unsafe/unavailable" rule.
- **Policy caught it?** No — there was nothing for policy to evaluate.
- **Could incorrect state have executed?** No (no action was proposed), but the **absence of a finding is itself the failure** — a real system must flag injection and missing context, not silently pass.
- **Proposed smallest general fix**: add a deterministic top-level guard that emits `unsafe` when (a) the raw interaction contains injection markers, or (b) `truncated === true`, or (c) a required authoritative source is unavailable — before/independent of semantic extraction.
- **Regression risk**: Low (additive guard; doesn't change existing classifications).

### F-03 — Commercial-vs-CRM reconciliation requires a signal trigger (reliability)

- **Failure ID**: F-03
- **Case**: case-10 "Trial expired + grace expired + no subscription + no exception"
- **Expected**: `stale` (Closed Lost eligible)
- **Actual**: no findings (0 tool calls — commercial/deal never retrieved)
- **Layer**: B → C (selective retrieval gating reconciliation)
- **Severity**: Medium
- **Root cause**: `reconcileOperationalState` needs both commercial state and the open deal, but the bounded agent only retrieves those when a *semantic signal* exists. Case-10's transcript ("trial window has long passed") doesn't trigger any signal, so the agent retrieves nothing and the operational reconciliation never runs.
- **AI/model wrong?** Partly — the extractor missed "trial window has long passed" as a churn signal; but the deeper issue is that operational (commercial vs CRM) reconciliation is gated on conversation signals.
- **Policy caught it?** N/A (nothing reached policy).
- **Could incorrect state have executed?** No (missed a Closed Lost *recommendation*, i.e., a false negative — lower risk than F-01 but a real gap-detection miss).
- **Proposed smallest general fix**: always retrieve commercial state + open deal for the account (a bounded, deterministic baseline retrieval) so `reconcileOperationalState` can run regardless of conversation content.
- **Regression risk**: Low (adds two read-only retrievals; can be bounded/deduped).

### F-04 — Semantic extraction is inadequate without a production LLM (evaluation impact)

- **Failure ID**: F-04
- **Cases**: case-01, case-02, case-06 (schema rejected), case-05 (false positive), case-08 (missed claim)
- **Expected**: `missing` (01/02/06), `aligned` (05), `contradictory` (08)
- **Actual**: empty / `missing` / empty respectively
- **Layer**: A — Semantics
- **Severity**: Medium (high evaluation impact, low safety — the deterministic validation caught the malformed cases)
- **Root cause**: the keyword stand-in extractor (a) emits malformed `deadline` objects missing the required `kind` field → deterministic schema validation correctly rejects (case-01/02/06), (b) misclassifies tentative "we'll figure out the date later" as a commitment (case-05), and (c) misses "we already signed / we're live" (case-08).
- **AI/model wrong?** Yes — the stand-in is wrong; this is *not* a defect in the interpreter's validation (which correctly rejected malformed output) or the reconciliation/policy layers.
- **Policy caught it?** Yes for 01/02/06 (schema validation → `valid=false`, no downstream). No for 05 (a spurious `create_task` proposal was produced).
- **Could incorrect state have executed?** Low — a spurious `create_task` (case-05) would require approval; no consequential transition was auto-executed.
- **Proposed smallest general fix**: wire the real DeepSeek `LLMProvider` adapter (the single largest lever); optionally add "we'll figure out later / we'll circle back" to the deterministic tentative-markers list as a stopgap.
- **Regression risk**: Low (replacing the stand-in LLM is the intended path; the tentative-marker addition is narrow).

---

## Recommended highest-value fixes (3–5)

1. **F-01** — Tighten `reconcileOperationalState` so Closed Won requires conversation corroboration (prevents spurious stage-change proposals). *Safety-critical.*
2. **F-02** — Add a deterministic `unsafe` guard for injection / truncation / unavailable source (fail-safe instead of silent pass). *Safety-critical.*
3. **F-04** — Wire the production DeepSeek LLM adapter (recovers the bulk of Layer A). *Highest evaluation impact.*
4. **F-03** — Always retrieve commercial + open deal so operational reconciliation isn't gated on conversation signals. *Reliability.*
5. *(Optional)* — Broaden the tentative-language markers ("figure out later", "circle back") as a cheap Layer-A stopgap until the real LLM lands.

No fixes have been implemented in this step.
