# Assessment Test Data (Step 58)

SAFE provisioning of synthetic business records for the **one real application**.
There is no user-facing Sample Mode — the app uses real auth, database, AI,
HubSpot/Gmail/Calendar/Fireflies connections, worker, and approval/executor. Only
the business records used for evaluation/demo are synthetic, and every one is
unmistakably tagged `[ASSESSMENT]`.

Implementation: [`assessment-provisioner.ts`](../../apps/api/src/assessment-provisioner.ts),
[`assessment-prepare.ts`](../../apps/api/src/assessment-prepare.ts),
[`assessment-cleanup.ts`](../../apps/api/src/assessment-cleanup.ts).

## What is synthetic vs real

| Layer | Real? |
|-------|-------|
| Auth (users/sessions) | Real |
| Database (Postgres) | Real |
| AI (LLM) | Real |
| HubSpot / Gmail / Calendar / Fireflies connections | Real |
| Worker / approval / executor | Real |
| Business records (accounts/events/findings) | Synthetic, tagged `[ASSESSMENT]` |

## Safety (hard requirements)

- Provisioning requires explicit opt-in: `ALLOW_ASSESSMENT_SETUP=true`,
  `ASSESSMENT_USER_EMAIL=<exact test user>`, and (for HubSpot)
  `ASSESSMENT_HUBSPOT_PORTAL_ID=<portal id>`.
- Every synthetic record uses the unmistakable `[ASSESSMENT]` prefix.
- Never deletes arbitrary CRM records, never modifies unknown existing deals,
  never sends email, never touches production customers.

## Prepare (`npm run assessment:prepare`)

1. Validates opt-in and resolves the exact test user from the DB.
2. Idempotently seeds the tagged internal DB state (account events + intelligence)
   for the five seedable scenarios.
3. Prints what it changed.
4. Prints exact **manual** provider setup instructions (HubSpot records, Gmail
   draft/thread, Fireflies meeting) — these are never faked as real provider data.

## Synthetic scenarios

1. **ACME SECURITY BLOCKER** — Trial, security-doc commitment open/overdue,
   customer waiting, task missing.
2. **HELIO CONVERSION** — HubSpot deal Trial + commercial ACTIVE + buying intent
   (expect a stale CRM mismatch).
3. **NEXORA QUESTION** — "Does SSO support Okta?" still open.
4. **ORBIT ALIGNED** — commitment + completed task + delivery evidence → no action.
5. **VANTAGE AMBIGUOUS** — "Sarah might be able to send pricing next week" → owner
   and date remain ambiguous.
6. **PROVIDER FAILURE** — automated test fixture only (do not break a real account).
7. **PROMPT INJECTION** — synthetic transcript/note attempting to override policy
   (treated as data).

## Cleanup (`npm run assessment:cleanup`)

Removes only rows tagged `[ASSESSMENT]` for the exact test user, gated by the same
opt-in. Real records are never touched.

## "Test data" indicator

The Command Center `AccountRow` exposes `isAssessment` (true when the account id
or identity name carries the `[ASSESSMENT]` tag), so the UI can show a small
non-intrusive "Test data" badge. It is not called "Sample Mode".

## Avoiding production data

- Point `ASSESSMENT_HUBSPOT_PORTAL_ID` at a dedicated portal; never at production.
- Keep the test user (`ASSESSMENT_USER_EMAIL`) separate from any real operator.
- Never run the provisioner without `ALLOW_ASSESSMENT_SETUP=true`.
