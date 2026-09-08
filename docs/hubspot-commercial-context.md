# HubSpot Commercial Context (Step 50.8)

Commercial state as a **distinct logical source** inside the per-user HubSpot
integration. No direct Stripe integration.

## Do not confuse sources

- **CRM / pipeline** = deal stage, owner, next step, tasks, notes.
- **Commercial** = subscription/payment/billing truth exposed inside HubSpot.

Deal stage is never commercial truth, and a conversation "I've decided to
subscribe" is never authoritative proof of payment. An LLM buying signal alone
never authorizes Closed Won.

## Source strategies (priority)

[`HubSpotCommercialContext`](../../packages/core/src/commercial/hubspot-commercial-context.ts)
implements `CommercialStateReadProvider` with:

1. **Native HubSpot Commerce subscription objects** — when the connected account
   exposes them and the token has read access (read-only; no mutation).
2. **Explicitly configured CRM property mapping** — the user maps commercial
   status into a known HubSpot deal/company property (status, optional start/end).
3. **unavailable / missing_context** — never guesses a property by name.

## Native subscriptions (read-only)

Where supported, subscription records + status + start/end + associations +
provider record id + provenance are read. Whether the user's token supports this
is determined at runtime, never assumed.

## Property-mapping fallback

Explicit per-user config: `objectType` (deal | company), `statusProperty`
(HubSpot property internal name), optional start/end properties, and an optional
`statusValues` map (`active | trialing | past_due | cancelled | none`). The user
selects known properties; the LLM never chooses which CRM property means payment
truth.

## Canonical contract & provenance

Reuses the existing `CommercialState` contract. `get_commercial_state`,
`get_customer_activity`, `get_commercial_exception` remain, but commercial state
is routed through `HubSpotCommercialContext`. `resolve()` returns
`resolved | unavailable | conflicting | missing_context`. Provenance records
native-vs-property source, object id, and property used — never credentials. A
provider failure is **never** treated as "not subscribed".

## Closed Won policy (unchanged)

No weakening. Candidate eligibility requires a resolved deal with authoritative
`active` commercial state from HubSpot, CRM not already Closed Won, a successful
source retrieval, no unresolved identity conflict, and human approval.
Conversation purchase intent may explain, never authorize.

## Assessment setup

`npm run assessment:hubspot:setup` (opt-in via `ALLOW_ASSESSMENT_SETUP=true`)
creates a clearly-named `revexec_billing_status` enumeration property on deals and
companies if the token permits, else prints the exact manual HubSpot steps. It
never touches arbitrary production CRM schema.

## Tests

[`hubspot-commercial-context.test.ts`](../../packages/core/src/__tests__/hubspot-commercial-context.test.ts)
covers native active subscription, property-mapping active, no mapping →
unavailable, native endpoint failure (timeout) → unavailable (never "not
subscribed"), cancelled → no subscription, custom status mapping, and source
provenance.

---

## MANUAL CHECKPOINT 50.8

1. **Does your real HubSpot test account expose native Commerce subscriptions?**
   I can't verify this from here — it depends on your portal + token scopes. Run
   `ALLOW_ASSESSMENT_SETUP=true npm run assessment:hubspot:setup`; if it reports the
   property already exists, then set it manually. (Native subscription *objects* are
   Commerce Hub / Sales Enterprise features; a plain starter portal usually does
   **not** have them.)
2. **If native subscriptions aren't available**, the setup script attempts to create
   `revexec_billing_status` (deal + company). If it lacks permission, create it
   manually in HubSpot → Settings → Objects → Deals → Properties (enumeration with
   Active / Trialing / Past Due / Cancelled / None-Unknown), then set `revexec_billing_status = active`
   on a synthetic **Trial** deal.
3. Confirm in the product that this Trial deal + `active` commercial property
   reconciles to a **stale** pipeline → candidate recommendation Trial → Closed Won →
   **approval required** (never auto-executed).