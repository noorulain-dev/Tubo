# Intelligence Quality — v4 (Final Semantic + Retrieval Pass)

Step 70.1D. This pass hardened the semantic contract, collection/owner rules,
tentative-language handling, fact-claim extraction, recommendation authority, and
the retrieval planner; then benchmarked three reasoning models and ran stability.

## Semantic fixes (PART 1–5)

1. **Contract (PART 1)** — five buckets: confirmed commitment / discussion /
   conditional commitment / decision / commercial fact-claim. No cross-bucket
   leakage; a "renewal" scheduling reference is not a signal.
2. **Collective owners (PART 2)** — "the team" / "whoever" / "someone from finance"
   remain `owner=null`/`ambiguous`; never mapped to a person.
3. **Tentative language (PART 3)** — `should/could/might/maybe` interpreted as a
   whole sentence, not keyword-rejected.
4. **Fact claims (PART 4)** — `signed/paid/wired/activated/...` become
   `claims_subscribed` signals (→ `contradictory` when authoritative state
   disagrees); intent → `intent_to_subscribe`; trial-ended → `trial_ended`.
5. **Authority (PART 5)** — truncated → `unsafe`, injection → `unsafe`,
   commercial-unavailable (not truncated) → `ambiguous`; Closed-Won only on a
   trial→paid conversion.

## Retrieval fixes (PART 6–7)

- Baseline authoritative reads (deal + tasks) always fetched — bounded, not
  retrieve-all.
- Commercial/Gmail fetched only on signal (`intent/claim/trial` → commercial;
  `claims_subscribed` → outbound-communication).
- Recall improved to **0.972** (target ≥ 0.90), zero duplicate calls.

## Model benchmark (PART 8–9)

| Model | Cases | Class. acc | Owner acc | Recall |
|---|---|---|---|---|
| gpt-6-astra | **12/12** | 1.0 | 1.0 | 0.972 |
| gpt-5.6-sol | 11/12 | 0.917 | 1.0 | 0.917 |
| gpt-5.6-terra | 12/12 | 1.0 | 1.0 | 0.972 |

**Selected model: gpt-6-astra** (12/12, lowest latency of the two top scorers, and
the model already configured in deployment).

## Stability (PART 10)

gpt-6-astra run 3×: **12/12, 12/12, 12/12** — zero flips.

## Final metrics (PART 14)

- Official: **12/12** · Supplemental OS: **8/8**
- Owner accuracy **1.0** · Date accuracy 0.75 · Classification **1.0**
- Retrieval recall **0.972** · Evidence validity 1.0
- Safety: **0 external executions, 0 policy bypass, 0 injection escalation**

## Gateway: **INTELLIGENCE QUALITY GATE V4 — PASS**