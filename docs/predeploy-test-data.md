# Pre-Deployment Test Data Inventory (Step 70.2)

All business records used for acceptance are **synthetic** and unmistakably tagged
`[ASSESSMENT]`. Provisioning is opt-in only (`ALLOW_ASSESSMENT_SETUP=true`,
`ASSESSMENT_USER_EMAIL`, and optionally `ASSESSMENT_HUBSPOT_PORTAL_ID`), idempotent,
and never touches production customers. There is **no Sample Mode** — these records
are seeded into the one live runtime's own database via the event ledger.

Run once before manual testing:

```bash
npm run assessment:prepare
```

This seeds the *seedable* scenarios below as `[ASSESSMENT]`-tagged AccountEvents.
Provider-dependent records (HubSpot/Gmail/Calendar/Fireflies) are created manually
and tagged with the same `[ASSESSMENT]` prefix.

## Accounts

| ID | Scenario (provisioner slug) | What it exercises | Seedable |
|----|------------------------------|-------------------|----------|
| ACCOUNT A | `acme-security-blocker` | missing commitment/task + open blocker + customer-waiting | ✅ `assessment:prepare` |
| ACCOUNT B | `orbit-aligned` | equivalent existing task (aligned, no action) | ✅ `assessment:prepare` |
| ACCOUNT C | `helio-conversion` | CRM/commercial mismatch (Trial vs Active) | ✅ `assessment:prepare` |
| ACCOUNT D | `nexora-question` | unanswered customer question | ✅ `assessment:prepare` |
| ACCOUNT E | `vantage-ambiguous` | ambiguous collective owner + date | ✅ `assessment:prepare` |
| ACCOUNT F | *(manual — resolved blocker)* | blocker resolution invalidates finding | ✏️ manual (see below) |
| ACCOUNT G | *(manual — rejected investigation)* | investigation REJECTED removes dependent action | ✏️ manual (see below) |
| ACCOUNT H | `prompt-injection` (fixture) | injection → unsafe, no authority change | 🧪 automated only |

Provider-failure and prompt-injection are **automated test fixtures** — do not
deliberately break a real provider during acceptance.

## Manual provider records (external)

| Provider | What to create | Tag |
|----------|----------------|-----|
| HubSpot | synthetic Company + Deal + Contact, plus `revexec_billing_status` property (see `npm run assessment:hubspot:setup`) | `[ASSESSMENT]` |
| Gmail | one draft/thread per scenario, `[ASSESSMENT]` in subject | `[ASSESSMENT]` |
| Google Calendar | one harmless synthetic meeting on a test calendar | `[ASSESSMENT]` |
| Fireflies | use an **already recorded** synthetic meeting; never record a new one live | existing |

## ACCOUNT F — resolved blocker (manual)

1. Create a synthetic account whose snapshot has an open blocker (e.g. "awaiting
   legal sign-off").
2. Through the supported write path, resolve the blocker (or provide the
   fulfilment evidence).
3. Confirm the blocker + its dependent finding/action are invalidated and no
   longer appear active.

## ACCOUNT G — rejected investigation (manual)

1. Open a `missing_operational_task` finding on a synthetic account.
2. Run Investigate; provide/observe evidence that the hypothesis is **rejected**
   (e.g. the "missing" task actually exists out-of-band).
3. Confirm `REJECTED` outcome and that no dependent proposal remains active.