# Intelligence Quality Gate (Step 70.1)

STOP before production deployment. This is an engineering gate, not a
ground-truth modification target.

## Forensic attribution (gpt-4o, frozen official 12)

Produced by [`diagnostics.ts`](../../apps/api/src/diagnostics.ts) and written to
[`evals/diagnostics/case-01..12.json`](../../evals/diagnostics) and
[`evals/intelligence-root-causes.md`](../../evals/intelligence-root-causes.md).

| Category | Cases | Interpretation |
|---|---|---|
| SEMANTIC_MODEL | 4 | the model invents an owner/date, misses a commitment, or misses a contradiction |
| RECONCILIATION_LOGIC | 4 | the deterministic classifier produces `missing`/`ambiguous` where `aligned`/`duplicate`/`contradictory` was expected |
| AGENT_RETRIEVAL | 2 | the bounded planner did not retrieve a required source (injection/truncated → `unsafe`) |
| GROUND_TRUTH_QUESTION | 2 | flagged for human review (not modified) |

**Key finding:** correctness is dominated by **model imprecision + deterministic
reconciliation classification**, not by retrieval. Retrieval recall (0.792) is a
secondary factor.

## Model benchmark

- `gpt-4o` (current): 4–5/12.
- `gpt-5.6-sol`, `gpt-5.6-terra`: **unavailable** on the configured OpenAI account
  (non-existent model ids under the repo's OpenAI-compatible client), so the A/B/C
  experiments could not be run. `gpt-4o` (or DeepSeek, if configured) remains the
  only usable model.

## Acceptance thresholds vs measured

| Gate | Target | Measured | Verdict |
|---|---|---|---|
| Official 12 | ≥ 10/12 | 4–5/12 | **FAIL** |
| Supplemental OS 8 | ≥ 7/8 | 8/8 | PASS |
| Required-context recall | ≥ 0.90 | 0.792 | **FAIL** |
| Incorrect external execution | 0 | 0 | PASS |
| Approval bypass | 0 | 0 | PASS |
| Prompt-injection authority escalation | 0 | 0 | PASS |

## General fixes identified (not yet all applied)

1. **Reconciliation** — "no commitment + no equivalent task → aligned/no action"
   (currently can yield `missing`); equivalent task → `duplicate`; conversation vs
   authoritative source → `contradictory`; authoritative-changed-while-CRM-stale →
   `stale`. Several of these were producing `missing`/`ambiguous`.
2. **Bounded agent recall** — commercial signal → retrieve commercial context;
   possible commitment → task dedupe check; contradiction → retrieve current CRM
   state. Do not retrieve everything.
3. **Semantic prompt** — reinforce: "we should X" ≠ commitment; "I'll X" = internal
   commitment; "Sarah might X" = uncertainty; "decided to subscribe" = intent, not
   authoritative active subscription; "almost done" ≠ complete.

## Safety status (non-negotiable, unchanged)

Read-only agent, no Gmail send, no automatic high-risk CRM mutation, Closed Won
requires authoritative commercial evidence, human approval, tenant isolation, and
prompt injection cannot change tools or policy — all preserved. A higher pass rate
with weaker safety is **not** an improvement.

## Conclusion

The current configuration does **not** meet the preferred pre-deployment gate on
final correctness and retrieval recall. The blocker is a combination of semantic
model quality and deterministic reconciliation classification, plus a missing
usable benchmark model (gpt-5.6 unavailable).

---

## INTELLIGENCE QUALITY GATE

- Official: **4–5/12**
- Supplemental: **8/8**
- Required-context retrieval recall: **0.792**
- Must-not-execute violations: **1**
- Incorrect external execution eligibility: **0**
- Selected semantic model: **gpt-4o**
- Selected agent model: **gpt-4o** (agent is deterministic retrieval; no model)

### **FAIL**

Do **not** deploy. Do **not** proceed to Step 71.