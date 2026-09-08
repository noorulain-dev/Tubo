# Step 50.3 — Core Verification (HubSpot + Gmail Live Mode)

Proves the existing HubSpot/Gmail pipeline end-to-end using each authenticated
user's **real** connection. No Calendar, Fireflies, or commerce is added.

## Step 50.2 invariants (verified)

1. **Per-user providers** — [`LiveProviderResolver`](../../apps/api/src/provider-resolver.ts) reads the
   user's `connections` rows (HubSpot token, Gmail refresh token) and builds real
   providers. No operator-global credential replaces a signed-in user's connection.
2. **Postgres persistence** — runs/proposals persist via [`PostgresRunStore`](../../apps/api/src/store-pg.ts).
3. **Audit persists** — [`PostgresAuditSink`](../../apps/api/src/store-pg.ts) writes to `app_audit`.
4. **Approvals persist** — stored on the proposal payload in `app_proposals`.
5. **Idempotency survives restart** — [`PostgresExecutionStore`](../../apps/api/src/store-pg.ts).
6. **No silent InMemory fallback** — `createLiveApp` always uses `PostgresRunStore`;
   `InMemoryRunStore` is only for sample-mode tests.

## Provider resolution path

`POST /interactions` (live) → `currentUser()` → `service.process(input, userId)` →
`LiveProviderResolver.resolve(userId)` → `getHubspotAccessToken(userId)` /
`getGmailRefreshToken(userId)` (decrypted) → real `HubSpotCRMProvider` / `GmailProvider`,
each with a user-scoped Postgres audit + execution store. Unconnected integrations
become **empty** providers (no fabricated data), never another user's connection.

## Secret storage / encryption

Connection secrets (HubSpot PAT, Gmail refresh token, future providers) are stored in
`connections.secret`. [`encryption.ts`](../../apps/api/src/encryption.ts) applies AES-256-GCM
authenticated encryption when `INTEGRATION_ENCRYPTION_KEY` (a 32-byte base64 key) is set:

- Writes encrypt; reads decrypt.
- Values without the `enc:v1:` prefix are treated as **legacy plaintext**
  (backward-compatible path), so existing rows keep working.
- Decrypted secrets are never returned via API responses, logs, frontend, or audit
  (the `/connections` endpoint returns only `connected`/`needsReauth` booleans).
- `npm run generate:integration-key` prints a fresh key.

## Gmail token lifecycle

[`GmailTokenManager`](../../apps/api/src/provider-resolver.ts) caches the access token and
refreshes it near expiry using the stored refresh token. On refresh failure the
resolver distinguishes:

- **4xx (revoked consent)** → `markNeedsReauth(userId, "gmail")`, connection shows
  `needsReauth: true`; gmail becomes an empty provider (never "no email exists").
- **5xx/429/network (temporary)** → empty provider only, no `needs_reauth` flag.

No send capability is added.

## HubSpot

- `npm run smoke:hubspot` — read-only.
- `npm run smoke:hubspot-write` — **opt-in** (`ALLOW_LIVE_TEST_WRITES=true`): create a
  `[smoke …]` TEST task → read back, create a TEST note → read back. Never changes a
  deal stage.

## Gmail

- `npm run smoke:gmail` — read-only (list threads, read a thread, outbound check).
- `npm run smoke:gmail-draft` — **opt-in** (`ALLOW_LIVE_TEST_WRITES=true`): creates a
  fixed-subject `[Revenue Execution OS Test] Draft Verification` draft; a repeat run
  reuses the existing draft (subject-match check) instead of creating duplicates.
  Never sends.

## Application execution + idempotency

`CREATE_HUBSPOT_TASK` / `CREATE_GMAIL_DRAFT` proposals follow the normal approval flow:
unapproved → `POLICY_BLOCK`; approved → real write; repeat execute → duplicate
prevented (execution idempotency store).

## Tenancy / security (tested)

`tenancy.test.ts` proves User B cannot read, **approve**, **reject**, **edit**, or
**execute** User A's run or proposal (even knowing the object ID), and that ownership
survives service recreation.

## Automation

- `npm run verify:step50-core` — deterministic, non-destructive (auth, isolation,
  persistence, HubSpot/Gmail providers via mocks, policy, approval, idempotency, audit).
- External write checks (`smoke:hubspot-write`, `smoke:gmail-draft`) are explicit
  opt-in and separate.

---

## MANUAL CHECKPOINT 50.3

1. **HubSpot real write** — `ALLOW_LIVE_TEST_WRITES=true npm run smoke:hubspot-write`
   (with `HUBSPOT_SMOKE_COMPANY_ID`); confirm a `[smoke …]` task **and** note exist on
   that company, and no deal stage changed.
2. **Gmail real draft** — `ALLOW_LIVE_TEST_WRITES=true npm run smoke:gmail-draft` (with
   `SMOKE_GMAIL_TO`); confirm the `[Revenue Execution OS Test]` draft is in Gmail →
   Drafts and **nothing is in Sent**.
3. **UI approval flow** — sign in, run a Live interaction yielding `create_task`,
   try Execute before approving (must be blocked), approve → execute, confirm the task
   exists in HubSpot, execute again → confirm **no duplicate**.
4. **Encryption at rest** — after setting `INTEGRATION_ENCRYPTION_KEY`, confirm the
   `connections.secret` column stores ciphertext (`enc:v1:…`), not a readable PAT/token.
5. **Cross-user isolation + restart** — sign in as User B and open User A's run/proposal
   ID (must not load); restart the API and confirm User A's run, approval, and audit
   trail are still present and re-execute is still refused.
