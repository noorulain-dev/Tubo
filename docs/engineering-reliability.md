# Engineering Reliability (Step 71)

Hardening applied to the frozen intelligence core. Nothing here touches semantic
interpretation, reconciliation, the retrieval planner, policy authority, model
selection, or the frozen eval fixtures.

## Validation

- Consequential public endpoints validate request bodies with **Zod**
  (`InteractionInputSchema`, `ProposalEditSchema` in `apps/api/src/types.ts`).
- New auth endpoints validate email/token/password minimally before any work.
- Environment and provider configuration is validated in
  [`config.ts`](../packages/core/src/config.ts) (single reader of `process.env`).
- LLM structured responses are schema-validated in
  [`semantic-interpreter.ts`](../packages/core/src/interpreter/semantic-interpreter.ts)
  and provider result schemas are checked in the agent tool layer.

## Structured logging

- **pino** (`apps/api/src/logger.ts`) — structured JSON in production with
  automatic redaction of authorization headers, tokens, secrets, API keys,
  passwords, verification/reset tokens.
- Request logging middleware emits `event/timestamp/level/request_id/method/path/
  status/latency_ms/user_id`.
- Worker/error paths use the same logger; `handleError` logs unhandled errors with
  an `error_code` without leaking stack traces in production.
- Build-script `console.*` output is intentionally left as-is (harmless).

## Request correlation

- Every request gets a `request_id` (accepts a safe inbound `X-Request-ID` or
  mints one), echoed in the `X-Request-ID` response header and embedded in error
  envelopes and logs. Worker jobs carry `job_id`/`run_id`.

## Timeouts

- The reasoning agent already bounds its run with `timeoutMs`.
- A reusable [`withTimeout`](../apps/api/src/retry.ts) wraps external calls and
  throws `TimeoutError` (retryable), logged distinctly from generic internal errors.

## Retry policy

- Reusable [`withRetry`](../apps/api/src/retry.ts): bounded exponential backoff
  with full jitter and a hard attempt cap. Retries **only** network errors, 408,
  429, and 5xx — never 400/401/403/404, validation, or policy rejections.
- The job worker retains its own persisted retry/backoff (`jobs.ts`).

## Fallbacks

- Commercial unavailable → `missing context` (never infers "not subscribed").
- Gmail unavailable → cannot prove message absence.
- LLM failure → processing failure / needs review; no consequential execution.
- Worker failure → persisted failed/retryable job.
- External execution ambiguous → no success claim without confirmation.
- Production DB unavailable → readiness fails; no silent in-memory store.
- Real model unavailable → fails visibly; no fake/keyword model fallback.

## Idempotency

- Persistence-backed idempotency across: interaction ingestion, Fireflies artifact
  ingestion, worker jobs (`idempotency_key UNIQUE`), HubSpot task/note/stage,
  Gmail draft, and execution actions (`app_executions.signature` unique). Survives
  restart because keys are stored in Postgres.

## Auth token security

- Session tokens: 32-byte random, server-side hashed*; 30-day TTL.
- Passwords: per-user salt + `scrypt` (`apps/api/src/password.ts`).
- Verification/reset tokens: 32-byte random, **SHA-256 hash only** stored,
  single-use, short TTL (`verification_tokens`, `password_reset_tokens`).
- Forgot-password returns a generic success and never reveals account existence;
  a successful reset invalidates all sessions for that user.
- Existing pre-migration users are backfilled to `email_verified_at IS NOT NULL`
  exactly once (guarded by `schema_migrations`), so they are never locked out.

## Error responses

`{ error: { code, message, requestId, details? } }` with stable codes:
`VALIDATION`, `UNAUTHENTICATED(AUTHENTICATION)`, `FORBIDDEN(PERMISSION)`,
`NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`,
`PROVIDER_REAUTH_REQUIRED`, `MODEL_UNAVAILABLE`, `MISSING_CONTEXT`,
`EXECUTION_BLOCKED`, `EMAIL_NOT_VERIFIED`, `INTERNAL_ERROR`. Stack traces are
never exposed in production.

## Health / readiness

- `GET /health` — process liveness.
- `GET /ready` — critical-dependency (database) readiness (503 when down); no
  credentials/account details are returned.

## Known limitations

- In-memory, per-process rate limiting (not distributed); fine for a single
  instance, but a shared store is needed for horizontal scale.
- The repo uses raw `pg` (no ORM/migration runner). Schema is maintained via an
  idempotent `ensureSchema()` bootstrap that mirrors `db/migrations/*.sql` (this
  is the existing convention — see `0001_initial.sql`, `0002_tenancy.sql`,
  `0003_email_verification.sql`). Parameterized queries are used everywhere (no
  string-concatenated SQL).
- Email delivery requires a transactional provider (Resend via `RESEND_API_KEY`,
  or SMTP) — in production, a missing provider is a hard error rather than a
  silent pretend-send.