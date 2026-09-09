# Code Architecture (Revenue Execution OS API)

Final architecture after Steps 71B.1–71B.12. The frozen AI intelligence core
(`packages/core` semantic interpretation / reconciliation / planner / policy /
model, and `evals/*` fixtures) is intentionally out of scope of this restructuring.

## module structure

The API was migrated from a flat ~60-file `src/` directory into feature modules:

```
apps/api/src/
├── index.ts                 # server bootstrap
├── app/                     # HTTP app (app.ts), live/sample wiring
├── auth/                    # auth-service, auth-repository, email-verification.service,
│                            #   verification (password reset), password, email, encryption, auth.schemas
├── accounts/                # account-intelligence(+service), account-refresh, command-center,
│                            #   risk-scanner, state-builder, investigation, canonical-interaction,
│                            #   fireflies-ingest, finding/investigation repositories
├── runs/                    # pipeline (RunService), store, store-pg, pipeline-service
├── proposals/               # execution-plans, plan-service, plan-repository
├── jobs/                    # worker, job-handlers, jobs
├── database/                # client (pool/tx/health), db (facade), schema-bootstrap, migrate
├── integrations/            # provider-resolver, connections, gmail-oauth, calendar-sync/watch
├── observability/           # logger, retry, rate-limit, predeploy-check
├── evaluation/              # eval runners (system/os/harness/diagnostics/comparison)
├── cli/                     # assessment + smoke scripts, generate-key, live-check
└── shared/                  # core (barrel), types, sample-fixtures
```

## dependency direction

`routes → services → repositories → database/client`, with `shared/core` (the
`packages/core` barrel) and `shared/types` as leaves. Provider adapters live in
`packages/core/**` and are wired through `apps/api/src/integrations` (resolver +
credential storage). No reverse (repository → service → route) runtime imports.

## route / service / repository pattern

- **routes** (`app/app.ts` handlers): validate → resolve user/context → call
  service → serialize. No business logic, no SQL, no provider orchestration.
- **services** (`*-service.ts`): use-cases (e.g. `createExecutionPlan`,
  `recordManualInteraction`, `email-verification.service`).
- **repositories** (`*-repository.ts`): raw parameterized SQL (parameterized; no
  ORM). Feature services call repositories via stable functions, and origin
  services re-export them so existing importers/tests are unchanged.

## database strategy

A single Postgres pool in [`database/client.ts`](apps/api/src/database/client.ts)
(`getPool`, `isDbConfigured`, `pingDb`, `withTransaction`). Feature modules never
construct their own pool.

## raw SQL rationale

Raw parameterized SQL via [`pg`] is used deliberately (no ORM) to keep the schema
explicit and avoid an abstraction layer; the earlier restructure moved it out of
routes and into repositories.

## migration strategy

`db/migrations/*.sql` is the canonical *forward* versioned history, applied by a
lightweight runner [`database/migrate.ts`](apps/api/src/database/migrate.ts)
(`schema_migrations` + ordered + apply-once + transaction). The runtime schema's
source of truth is the idempotent bootstrap [`database/schema-bootstrap.ts`](apps/api/src/database/schema-bootstrap.ts)
(`CREATE … IF NOT EXISTS`, safe on every startup, never drops/resets data). The
legacy `0001_initial.sql` (aspirational uuid model) is not auto-applied.

## transaction helper

`withTransaction(async tx => …)` in `database/client.ts` guarantees
BEGIN → fn → COMMIT, ROLLBACK on error, and client `release()` in `finally`. Used
for atomicity: job claim/update, verification token consume + mark-verified,
password reset consume + rotate + session invalidation.

## provider adapters

In `packages/core/**`: `hubspot/{client,normalize,crm-provider}`,
`gmail/{client,normalize,provider}`, `calendar`, `fireflies`, `commercial`,
`stripe`, `llm/openai-provider` (Responses↔Chat). Each normalizes raw provider
shapes to canonical types; business services consume only `AgentReadContext`
canonical types. Credentials are stored encrypted (`connections`) and resolved
server-side only (`provider-resolver`).

## config strategy

Zod-validated [`config.ts`](packages/core/src/config.ts) `loadConfig()` is the
single env reader; it exposes both flat fields (deployment-compatible names) and
typed `configSections()` (`database/auth/openai/google/hubspot/fireflies/email/app`).
Application code no longer reads `process.env` directly (only CLI scripts do, for
opt-in flags). Secrets are never passed to the frontend.

## error handling

Typed `AppError` (`code`, `message`, `status`/`statusCode`, `retryable`,
`details`/`safeDetails`) in `packages/core/src/errors.ts`, with a single
centralized handler in `app/app.ts` (`handleError` + `app.onError`) that normalizes
unknown/Postgres errors to stable codes, includes `requestId`, and never leaks
stack traces, tokens, credentials, or raw SQL. Error responses are
`{ error: { code, message, requestId?, details? } }`.

## logging

pino structured JSON (`observability/logger.ts`) with redaction of tokens/secrets/
credentials; request logging with `requestId`/`userId`/latency; job `job_id`/
`run_id` correlation; DB errors logged at the client layer (code/message only).

## testing

278 Vitest tests across `packages/core` (156) and `apps/api` (122): unit coverage
of semantic interpreter, reconciliation, policy, providers, repositories, routes,
tenancy, and the frozen official/supplemental evaluation harnesses. Eval runners
remain frozen measurement tooling.

## src tree (concise)

```
apps/api/src/{app,auth,accounts,runs,proposals,jobs,database,integrations,observability,evaluation,cli,shared}