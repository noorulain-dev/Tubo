# Background Jobs (Step 50.6)

Durable, asynchronous integration ingestion backed by Postgres. No Redis, no
in-process `setTimeout`, no browser polling as the authoritative scheduler.

## Architecture decision

Postgres already exists and is the lowest-operations option. We use a **Postgres
table-backed queue** with `SELECT … FOR UPDATE SKIP LOCKED` for atomic, concurrent
claiming — the same primitives `pg-boss`/`graphile-worker` rely on — implemented as a
small, dependency-free module ([`jobs.ts`](../../apps/api/src/jobs.ts)). This avoids
introducing a heavy new dependency and its schema/migrations for this assessment,
while still being durable (jobs survive API restart) and safe under concurrent workers.
Redis was rejected because there is no existing reason to run it.

## Job types

- `calendar.sync` — sync a user's Google Calendar (meeting context only).
- `fireflies.sync` — discover recent Fireflies meetings (no-op if not connected).
- `fireflies.fetch` — fetch/normalize/persist one meeting artifact.
- `interaction.process` — process an ingested artifact (pipeline wiring deferred).
- Future (Step 51+): `account.refresh`, `account.scan`, `finding.investigate` are added
  as new types in the same registry without architectural change.

## Job record

`jobs` table: `id`, `user_id`, `type`, `resource_ref`, `payload` (IDs only),
`scheduled_at`, `status`, `attempts`, `max_attempts`, `last_error_code`,
`idempotency_key` (unique), `created_at`, `started_at`, `completed_at`. Statuses:
`scheduled | running | retrying | completed | failed | cancelled`.

## Tenancy

Job payloads contain **only IDs** — never credentials. The worker reloads the
connection server-side (decrypted via the integration encryption key) and verifies
ownership before calling a provider. A User A job cannot operate User B's integration
because the connection is keyed by `user_id` and the handler resolves only that user's
secret.

## Retries

Transient failures (`429`, provider 5xx, network/timeout) retry with bounded exponential
backoff (250ms → 60s cap). Permanent failures (revoked auth, invalid API key,
permission, malformed resource) are persisted as `failed` and never retried.
Classification helpers: `isTransientErrorCode` + `shouldRetry` in [`jobs.ts`](../../apps/api/src/jobs.ts).

## Calendar schedule

A periodic **scan** ([`worker.ts`](../../apps/api/src/worker.ts)) queries for connected
users and enqueues `calendar.sync` once per hourly idempotency bucket — a scalable scan,
not a per-user timer. It only refreshes meeting context and never triggers Fireflies
attendance.

## Fireflies discovery / fetch

`fireflies.sync` lists recent meetings and, for each unseen one (idempotent identity =
user + provider + meeting id), enqueues `fireflies.fetch`. Already-ingested meetings are
skipped; no connection / no new meeting is a successful no-op; a Calendar meeting with
no Fireflies meeting does nothing. `fireflies.fetch` retrieves/normalizes/persists the
artifact and enqueues `interaction.process` (it does **not** run the LLM pipeline during
provider polling).

## Worker commands

- `npm run worker` — long-running worker process.
- `npm run dev:worker` — watch-mode worker for development.

## Observability

Structured `job_events` rows (`queued/started/retrying/completed/failed`) are persisted.
Transcripts and secrets are never logged by default.

## Tests

[`jobs.test.ts`](../../apps/api/src/__tests__/jobs.test.ts) covers backoff bounds,
transient-vs-permanent classification, no-infinite-retry, and the handler registry. The
DB-backed queue behaviors (durable survive-restart, `SKIP LOCKED` concurrency,
idempotency-key dedupe) are exercised by the `SKIP LOCKED`/`ON CONFLICT` SQL and are
documented here; a live-DB integration test requires a running Postgres.

---

## MANUAL CHECKPOINT 50.6

With your already-connected Calendar and Fireflies accounts, prove background discovery:

1. Start the API (`npm run dev`) **and** the worker in a second terminal
   (`npm run worker`). The worker runs one scan on startup.
2. Wait ~30 seconds, then check the DB:
   `SELECT type, status, user_id FROM jobs ORDER BY created_at DESC LIMIT 20;` — you
   should see `calendar.sync` and `fireflies.sync` (completed), then `fireflies.fetch`
   and `interaction.process` for any meetings not yet ingested.
3. Confirm ingestion: `SELECT provider_meeting_id, ingestion_status FROM meeting_artifacts
   WHERE user_id = '<your user id>';` — your recent Fireflies meetings should appear with
   `ingestion_status = 'fetched'` or `'processed'`.
4. Idempotency: run the scan again (restart the worker, or wait for the next hourly
   bucket) and confirm no duplicate `fireflies.fetch`/artifacts are created for the same
   meeting.
5. Crash recovery: stop the worker mid-run, restart it, and confirm it resumes claiming
   `scheduled`/`retrying` jobs (none are lost and nothing re-runs a `completed` job).