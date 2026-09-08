# Step 50 — Gap Analysis

This document records the **actual** state of the Revenue Execution OS repository as
of the Step-50 boundary, ahead of Account Intelligence (Step 51). It is a factual
inventory, not a design proposal. Nothing in this document has been implemented.

> **Correction to the stated "current facts":** the repository does **not** currently
> contain a Google Calendar integration or a Fireflies integration. The only "meeting"
> reference is the `meeting` value in `INTERACTION_KINDS` ([`enums.ts`](../../packages/core/src/enums.ts)). A
> search of the source for `calendar`, `fireflies`, `meeting` providers/clients returns
> nothing beyond that enum. This is called out explicitly in §4 and §10 below.

---

## 1. Auth and tenancy

**Status: present, single-level (user-only).**

- User accounts exist: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`,
  `GET /auth/me` ([`app.ts`](../../apps/api/src/app.ts)).
- Passwords are hashed with `scrypt` + per-user random salt ([`password.ts`](../../apps/api/src/password.ts)).
- Sessions are opaque random tokens stored in the `sessions` table with a 30-day TTL
  ([`auth-service.ts`](../../apps/api/src/auth-service.ts)). Requests authenticate via
  `Authorization: Bearer <token>`; the bearer middleware validates against `sessions`
  and attaches the user to the request context ([`auth.ts`](../../apps/api/src/auth.ts)).
- Public (unauthenticated) paths: `/health`, `/auth/register`, `/auth/login`,
  `/gmail/oauth/callback`. When `DATABASE_URL` is unset, auth is **disabled** (open mode)
  — this is what keeps the existing test suite green without a database.

**Tenancy gaps:**
- Tenancy is **single-level**: one `users` row = one set of credentials. There is no
  organization/workspace/team layer, no invitation, and no notion of "an account belongs
  to a workspace".
- The connection store is per-user (`connections.user_id`), but the processing pipeline
  does **not** yet read from it (see §5/§6).

## 2. HubSpot current capabilities

**Status: CRM objects only (companies/contacts/deals/notes/tasks).**

[`HubSpotCRMProvider`](../../packages/core/src/hubspot/hubspot-crm-provider.ts) implements both read and write:

- **Read:** `resolveAccount` (companies), `getContacts`, `getOpenDeal`, `getDeal`,
  `getRecentNotes`, `getOpenTasks`, `checkExistingAction`.
- **Write (executor-only):** `createNote`, `createTask`, `updateField`, `updateStage`.

Transport is [`HubSpotHttpClient`](../../packages/core/src/hubspot/hubspot-client.ts) against
`https://api.hubapi.com` using a private-app access token (`pat-…`).

**Not implemented:** HubSpot **commerce / subscription / payment** objects (line items,
products, quotes, invoices, subscriptions, payments), associations beyond the hard-coded
`associations.company` filter, and owner/team resolution. See §9.

## 3. Gmail current capabilities

**Status: read threads/messages + draft-only write; OAuth refresh-token flow.**

[`GmailProvider`](../../packages/core/src/gmail/gmail-provider.ts) implements `EmailProvider`:

- **Read:** `getThread`, `getMessage`, `hasOutboundCommunication`, `getDrafts`.
- **Write (executor-only):** `createDraft` (draft-only — there is deliberately no `send`).

OAuth 2.0 exists end-to-end ([`gmail-oauth.ts`](../../apps/api/src/gmail-oauth.ts)): authorize URL
build, authorization-code → refresh-token exchange, and a callback that stores the refresh
token per user. Scopes requested: `gmail.readonly` + `gmail.compose`.

**Not implemented:** `gmail.modify`/`gmail.send` (intentional), label management, and
auto-refresh of the access token on expiry (exchange happens once at provider build time).

## 4. Calendar current capabilities

**Status: none.** There is no Google Calendar provider, client, OAuth scope, schema, or
endpoint anywhere in the repository. No `calendar.*` module exists. This is a greenfield
surface for Step 51.

## 5. Current processing pipeline

**Status: deterministic pipeline, in-memory state.**

[`RunService`](../../apps/api/src/pipeline.ts) orchestrates:

1. **Semantic interpretation** — `SemanticInterpreter` over an OpenAI-compatible LLM
   (`gpt-4o` via `OPENAI_*`), producing a Zod-validated `SemanticState`.
2. **Bounded reasoning agent** — read-only tool registry
   ([`agent/tools.ts`](../../packages/core/src/agent/tools.ts)): `resolve_account`,
   `get_account_context`, `get_contacts`, `get_open_deal`, `get_recent_notes`,
   `get_open_tasks`, `get_email_thread`, `check_existing_action`,
   `get_commercial_state`, `get_customer_activity`, `get_commercial_exception`.
3. **Source-aware reconciliation** → findings/classifications.
4. **Execution-gap detection**.
5. **Deterministic policy** (`allow | block | require_approval`).
6. **Proposals** with human approve/reject/edit.
7. **Deterministic executor** (idempotent, bounded retry, draft-only email, Closed Won/Lost
   require approval).
8. **Audit trail** (in-memory `MemoryAuditSink`).

Runs/proposals are held in an in-memory `InMemoryStore`
([`store.ts`](../../apps/api/src/store.ts)) — **not** persisted to Postgres (see §6).

## 6. Current database

**Status: schema exists; only auth/connections actually read/write it.**

- [`db/migrations/0001_initial.sql`](../../db/migrations/0001_initial.sql) defines a full
  pipeline schema: `accounts`, `interactions`, `runs`, `semantic_items`, `agent_runs`,
  `tool_calls`, `source_snapshots`, `reconciliation_results`, `execution_gaps`, `proposals`,
  `policy_decisions`, `approvals`, `executions`, `user_corrections`, `evaluation_runs`,
  `audit_events` (+ indexes).
- [`db.ts`](../../apps/api/src/db.ts) adds (idempotently) `users`, `sessions`, `connections`
  and runs `ensureSchema()` at API startup via `pg` (`DATABASE_URL`).

**Gap:** the pipeline tables in `0001_initial.sql` are **unused at runtime**. The only
database operations performed today are auth (users/sessions) and connections. Runs,
proposals, audit, and evaluation are still in-memory and lost on restart.

## 7. Background-job / queue architecture

**Status: none.** No queue, worker, scheduler, cron, or background-job module exists. All
processing is synchronous within a single HTTP request. There is no mechanism to poll for
new Fireflies transcripts or to ingest asynchronously.

## 8. Proposal / policy / executor capabilities

**Status: present and deterministic.**

- **Policy** ([`policy/engine.ts`](../../packages/core/src/policy/engine.ts)): deterministic
  `allow | block | require_approval`; Closed Won/Lost eligibility rules; prompt-injection and
  self-approval blocking; allow-list support.
- **Proposals** ([`store.ts`](../../apps/api/src/store.ts), [`pipeline.ts`](../../apps/api/src/pipeline.ts)):
  approve/reject/edit with revision history and reviewer attribution.
- **Executor** ([`executor/executor.ts`](../../packages/core/src/executor/executor.ts)):
  idempotent (`execution_id` + `proposal_signature` dedupe), bounded retry on transient
  429/5xx only, partial-failure handling, draft-only email, no auto-send.

## 9. HubSpot commerce/subscription/payment objects accessible by current auth

**Status: unmodeled; scope unknown for commerce objects.**

The current `HubSpotCRMProvider` models **only** CRM objects: companies, contacts, deals,
notes, tasks. It does **not** call any commerce endpoints. HubSpot's commerce/subscription
surface lives under Commerce Hub objects — `line_items`, `products`, `quotes`, `invoices`,
`subscriptions` (Recurring Revenue), and `payments` — which require commerce/enterprise
scopes (e.g., `crm.objects.line_items.read`, `crm.objects.quotes.read`, invoice/subscription
scopes).

Whether the current private-app token (`pat-…`) includes those scopes is **unknown** and
must be verified before a HubSpot commercial-state provider can be built. To the extent the
customer's billing system syncs commerce data into HubSpot deals/properties, deal-level
custom properties are accessible today; dedicated commerce objects are not yet read.

## 10. Fireflies support

**Status: none.** There is no Fireflies client, webhook, OAuth, or transcript-ingestion
path anywhere in the repository. Per product decision, Fireflies remains an optional
user-owned integration: Revenue Execution OS would **ingest** transcripts Fireflies already
produced, never command Fireflies to join a meeting.

---

## STEP 50 IMPLEMENTATION BLOCKERS

Ranked in the order they must be resolved.

1. **Wire the pipeline to the per-user connection store (and to Postgres).**
   Today `createLiveApp` builds providers once from operator `.env`; the customer-facing
   `connections` table is not consulted by processing. Live runs must resolve Stripe/HubSpot/
   Gmail credentials from the authenticated user's `connections` rows, not from env. (Per
   the new direction, this is HubSpot commerce + Gmail, not a new Stripe integration.)

2. **Persist pipeline state to Postgres.**
   `0001_initial.sql` tables exist but are unused. Runs, proposals, approvals, executions,
   and audit must write to (and read from) the DB so a restart does not lose state, and so
   reconciliation/audit are queryable per account.

3. **Add Google Calendar integration (new surface).**
   No Calendar code exists. Needed for meeting context/metadata and matching transcripts to
   meetings. Requires a Calendar OAuth scope and a read-only provider.

4. **Add Fireflies ingest (read-only, user-owned).**
   No Fireflies code exists. Required: a webhook/credential to receive transcripts Fireflies
   independently produced, and a matching step against Calendar meetings. Never a "join
   meeting" command.

5. **Build HubSpot commercial/subscription/payment state.**
   Extend HubSpot to read commerce objects (or deal properties synced from billing) and map
   them to the existing `CommercialState` contract, replacing the synthetic/Stripe sources
   as the authoritative commercial provider. Verify the private-app token has the needed
   commerce scopes first.

6. **Add a background ingestion path.**
   No queue/worker exists. Fireflies/Calendar-driven flow (Option B) needs an async ingest
   job or at minimum a synchronous webhook handler that enqueues processing, because
   transcripts arrive outside a user's HTTP request.

7. **Tenancy hardening (optional, later).**
   Introduce workspace/organization grouping above `user_id` if multiple users must share
   a set of connections and accounts.

---

*No code was implemented as part of this Step 50 analysis.*
