# Fireflies Integration (Step 50.5)

Fireflies is an **optional, user-owned, read-only** meeting-notes integration.
Revenue Execution OS can ingest transcripts/summaries that the user's own
Fireflies account already produced, but it can **never** command Fireflies to
enter/record/join a meeting.

## Provider abstraction

[`MeetingNotesProvider`](../../packages/core/src/fireflies/fireflies-provider.ts) defines:
`validateConnection()`, `listRecentMeetings()`, `getTranscript(meetingId)`,
`getSummary(meetingId)`. [`FirefliesProvider`](../../packages/core/src/fireflies/fireflies-provider.ts)
implements it over Fireflies' GraphQL API (read-only). It has **no** bot/attendance
commands (`addToLiveMeeting`, `joinMeeting`, `removeBot`, `inviteBot`, etc. do not exist).

## Connection

The user's Fireflies API key is stored per-user in `connections` using the existing
AES-256-GCM encrypted-secret mechanism. It is never returned to the frontend, logged,
or placed in audit payloads. Connection states: `connected`, `needs_reauth`,
`disconnected`, `error`.

## Normalized artifact

[`MeetingArtifact`](../../packages/core/src/fireflies/fireflies-provider.ts) is the
provider-independent model (provider, provider_meeting_id, title, started/ended_at,
organizer, participants, calendar_reference, meeting_url, transcript, summary,
action_item_hints, provider timestamps, provenance). Downstream code never depends on
Fireflies' raw GraphQL field names.

## Action items are hints

Fireflies action items are `EXTERNAL_AI_HINTS`, not authoritative operational truth.
They are **not** turned directly into HubSpot tasks. The intended path is:
transcript/summary/hints → canonical interaction → our semantic interpreter → account
resolution → reasoning agent → reconciliation/policy. (This ingestion pipeline is wired
in a later step; this step only defines the read model + hint contract.)

## No-transcript behavior

A Calendar event with no Fireflies artifact is normal. Nothing is marked failed, nothing
retries forever, and no bot is assumed. The user may manually process notes.

## Database

`meeting_artifacts` (id, user_id, provider, provider_meeting_id, provider_updated_at,
metadata jsonb, ingestion_status, interaction_id nullable, timestamps) with a unique
`(user_id, provider, provider_meeting_id)` for future ingestion idempotency. Raw payloads
are not duplicated; only normalized metadata/evidence is kept.

## Frontend

Settings → Integrations → Fireflies: Connected / Not connected, **Test Connection**,
**Disconnect**, and an API-key connect field. Copy states Revenue Execution OS processes
meetings from your own Fireflies account and never sends Fireflies into a meeting. No
recording controls exist.

## Smoke & tests

- `npm run smoke:fireflies` — read-only (validate + list sanitized meetings).
- [`fireflies-provider.test.ts`](../../packages/core/src/__tests__/fireflies-provider.test.ts)
  covers normalization, empty transcript, missing summary, action-item hints, and the
  read-only shape (no bot/attendance methods).

---

## MANUAL CHECKPOINT 50.5

Only two things can't be automated (everything else — normalization, tenant isolation,
secret never exposed, read-only shape — is covered by tests):

1. **Obtain a Fireflies API key from your own account:** log in to
   https://app.fireflies.ai → Settings (or the API/integrations section) → create/view an
   API key/token. Paste it into the app at Settings → Integrations → Fireflies → **Connect**.
   (This is your own credential; Revenue Execution OS only stores it encrypted and uses it
   read-only.)
2. **Real read-only check:** with the key connected, click **Test Connection** (should
   succeed), then run `npm run smoke:fireflies` and confirm it lists a few of *your*
   Fireflies meeting titles. Confirm nothing was created or modified in your Fireflies
   account, and that the app never prompted to add a bot / join a meeting.