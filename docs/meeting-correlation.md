# Meeting Correlation (Step 50.7)

Conservative, deterministic identity/correlation for automatically ingested
meeting artifacts. No AI changes; no hidden chain-of-thought is stored.

## Fireflies → Calendar

[`correlateCalendar`](../../packages/core/src/correlation/meeting-correlation.ts) matches a
Fireflies meeting to one of the user's Calendar events, strongest evidence first:

1. provider/calendar **event id** (strongest),
2. exact **normalized meeting URL**,
3. **organizer + time overlap + strong participant overlap**.

Title alone is never authoritative. Result: `resolved | ambiguous | unresolved`.
An `unresolved` Calendar match does **not** block Fireflies processing — a Fireflies
artifact may exist for a meeting absent from Google Calendar.

## Reverse rule (never infer)

A Calendar meeting with **no** Fireflies artifact is normal. We never infer that
Fireflies "should have" recorded a meeting, never mark it failed, and never retry it.

## Internal identities

The authenticated user's known email identities are excluded from customer candidates.
Every non-user participant is **not** assumed to be a customer when evidence is weak.

## Meeting → HubSpot

[`resolveIdentity`](../../packages/core/src/correlation/meeting-correlation.ts) resolves the
customer identity using existing HubSpot reads:

- **exact participant email → contact** (strongest),
- contact's company association → **company**,
- company's **open deal**,
- participant/company **domain** (discovery evidence only, never sufficient alone).

It never derives identity from an email local-part, never invents emails, never picks an
arbitrary company/deal, and never creates phantom CRM objects.

## Resolution result

Typed `ResolutionResult`: `resolved | ambiguous | unsupported | missing_context |
conflicting`, with resolved company/contact/deal ids, candidate ids when ambiguous,
evidence references, and a reason code. No chain-of-thought is persisted.

## User review (pending wiring)

When account resolution is ambiguous/unresolved, semantic processing may continue, but
account-specific mutation proposals must not execute until the account is resolved. A
minimal UI lets the user pick from actual candidate HubSpot records; the chosen mapping
is persisted for that specific meeting/evidence (no broad fuzzy rules). This UI is a
follow-on to this deterministic module.

## Idempotency

Reprocessing the same meeting with the same evidence is deterministic (same input →
same result), so downstream ingestion is keyed by meeting id and won't duplicate
interactions/proposals.

## Tests

[`meeting-correlation.test.ts`](../../packages/core/src/__tests__/meeting-correlation.test.ts)
covers exact Calendar id, exact URL, organizer/time/participant fallback, two candidates,
no match, exact HubSpot contact → company → deal, multiple contacts, internal-only
meeting, domain-only ambiguity, and missing-context.

---

## MANUAL CHECKPOINT 50.7

To confirm identity resolution in the UI, create **one** synthetic arrangement:

- A HubSpot **contact** with a unique email (e.g. `buyer@acme-test.com`) associated to a
  single **company** ("Acme Test Corp") that has exactly one **open deal**.
- A Fireflies meeting where the only non-internal participant is `buyer@acme-test.com`
  (put yourself / your own email as the organizer so it's excluded as internal).

Then ingest that meeting: the correlation should resolve **resolved** with the contact
`buyer@acme-test.com`, company "Acme Test Corp", and that one deal — and the UI should
show a single, unambiguous account (no "choose a candidate" prompt).