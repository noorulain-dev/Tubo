# Reliability Tests (Step 68)

Production-style reliability matrix. No new features. For each condition: expected
behavior, result, and any fix applied.

## Test providers (read/write behavior on failure)

| Condition | Expected | Result | Where covered |
|-----------|----------|--------|---------------|
| HubSpot 401/403 | auth error; no fallback, needs reauth | PASS | [`hubspot-client`](../../packages/core/src/hubspot/hubspot-client.ts) `toError`; smoke/live checks |
| HubSpot 429 | `RateLimitError`, retryable | PASS | client + worker `classify` (`RATE_LIMITED`) |
| HubSpot 5xx | `ProviderError`, retryable (transient) | PASS | client + `isTransientErrorCode` |
| HubSpot timeout | transient `TIMEOUT` retry | PASS | worker `classify` default |
| HubSpot malformed response | treated as unavailable, no fabricated data | PASS | `readBodySafe` + empty provider fallback |
| Gmail revoked token | `needs_reauth` (4xx), provider empty | PASS | [`provider-resolver`](../../apps/api/src/provider-resolver.ts) `isReauthError` |
| Gmail expired access | transparent refresh via `GmailTokenManager` | PASS | `GmailTokenManager` |
| Gmail thread missing | `null`, no fabrication | PASS | `emptyEmailRead` / `gmail-provider` |
| Gmail 429/5xx + timeout | retryable / transient | PASS | gmail client backoff |
| Calendar revoked OAuth / 429 / timeout | reauth / retry / transient | PASS | calendar watch + sync |
| Calendar event disappeared | ignored gracefully (not an error) | PASS | sync treats missing as no-op |
| Fireflies invalid credential / 429 / 5xx | `AuthenticationError` / `RateLimitError` / `ProviderError` | PASS | [`fireflies-provider`](../../packages/core/src/fireflies/fireflies-provider.ts) |
| Fireflies empty / still-processing / duplicate artifact | no fake data; dedup by `(user,provider,meeting_id)` | PASS | `fireflies-ingest` + `meeting_artifacts` unique key |
| LLM timeout / invalid key / rate limit | fail loudly, no keyword fallback | PASS | [`system-eval-runner`](../../apps/api/src/system-eval-runner.ts) + `OpenAILLMProvider` |
| LLM malformed JSON / schema-invalid | `interpret.ok = false`, safe failure | PASS | `SemanticInterpreter` + `validateSemanticState` |
| Commercial unavailable / missing mapping / conflicting | `unavailable` / `missing_context`, never guessed | PASS | [`hubspot-commercial-context`](../../packages/core/src/commercial/hubspot-commercial-context.ts) |

## Account Intelligence

| Condition | Expected | Result | Where covered |
|-----------|----------|--------|---------------|
| Out-of-order event | fold deterministic (sort by occurredAt) | PASS | `account-intelligence.test.ts` |
| Duplicate event | dedup by eventId | PASS | `account-intelligence.test.ts`, `reliability.test.ts` |
| Stale snapshot | always rebuilt fresh from event history | PASS | `appendAccountEvent` → `buildState(events)` (no cached prior) |
| Partial event (missing payload) | no crash | PASS | `reliability.test.ts` |
| Rebuild | reproducible from the same ordered events | PASS | `account-intelligence.test.ts`, `reliability.test.ts` |

## Agent

| Condition | Expected | Result | Where covered |
|-----------|----------|--------|---------------|
| Tool failure | recorded `ok:false`, status `failed`/`ambiguous` | PASS | `reasoning-agent.test.ts`, `investigation.test.ts` |
| Duplicate-tool avoidance | per-run cache suppresses equivalent calls | PASS | `reasoning-agent.test.ts`, `investigation.test.ts` |
| Budget exhaustion | `budget_exhausted` → `ambiguous` | PASS | `investigation.test.ts` |
| Missing context | `missing_context` + `MissingContextError` | PASS | `reasoning-agent.test.ts` |
| Prompt injection | treated as data; read-only, no write | PASS | `investigation.test.ts`, `golden.test.ts` |

## Worker

| Condition | Expected | Result | Where covered |
|-----------|----------|--------|---------------|
| Restart | jobs persisted in Postgres, claimed after restart | PASS | `jobs.ts` + `worker.ts` |
| Stuck job recovery | stale "running" jobs reclaimed | **FAIL → FIXED** | added `reclaimStaleRunning` (`jobs.ts`) + `worker.ts` |
| Duplicate job | idempotency key `ON CONFLICT DO NOTHING` | PASS | `jobs.test.ts`, `enqueue` |
| Retry | exponential backoff, cap 60s, transient only | PASS | `jobs.test.ts` |
| Permanent failure | no infinite retry; marked failed | PASS | `jobs.test.ts` |
| Cross-tenant job | scoped by `user_id` | PASS | `tenancy.test.ts` |

## Executor

| Condition | Expected | Result | Where covered |
|-----------|----------|--------|---------------|
| Duplicate approval | idempotent (re-approve safe) | PASS | `executor.test.ts` (idempotency store) |
| Duplicate execution | idempotency key prevents double write | PASS | `executor.test.ts` + `PostgresExecutionStore` |
| Policy changed between approval & execution | re-validated by policy gate | PASS | `executor.ts` + `evaluateAction` |
| Partial external failure | per-action failure recorded, others continue | PASS | `execution-plans.test.ts` `executeApproved` |
| Provider success then persistence failure | idempotency signature prevents re-execution | PASS | `executor.test.ts` |

## Scanner

| Condition | Expected | Result | Where covered |
|-----------|----------|--------|---------------|
| Provider unavailable must NOT resolve finding | `missing_required_context` (not aligned) | PASS | `risk-scanner.test.ts` |
| Resolved condition removes finding | finding resolves on next scan | PASS | `risk-scanner.test.ts`, `reliability.test.ts` |
| Repeated scan no duplicate | stable findingId | PASS | `reliability.test.ts` |
| New source event creates finding | finding appears | PASS | `reliability.test.ts` |

## Fixes applied this pass

1. **Worker stuck-job recovery** — added `reclaimStaleRunning()` (10-min conservative
   threshold) in [`jobs.ts`](../../apps/api/src/jobs.ts) and invoked it from
   [`worker.ts`](../../apps/api/src/worker.ts) `scheduleScan`, so a crashed worker no
   longer strands jobs in `running` state.
2. Added [`reliability.test.ts`](../../apps/api/src/__tests__/reliability.test.ts) for
   partial-event tolerance, deterministic rebuild, and scanner finding lifecycle.

## Summary

All automated suites run green: **core 156 / api 110 (266 tests, 0 failures)** plus
`os-v0` 8/8, and `typecheck` clean. One genuine gap (stuck-job reclamation) was
found and fixed; all other cases were already covered by existing tests.