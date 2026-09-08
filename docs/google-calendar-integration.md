# Google Calendar Integration (Step 50.4)

Per-user **read-only** Google Calendar, for meeting context and correlation only.
Revenue Execution OS never records meetings, never commands Fireflies, and requests
no Calendar write/delete scope.

## OAuth scope & capability

- Reuses the existing Google OAuth client (`GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`)
  and the shared authorize/callback plumbing in
  [`gmail-oauth.ts`](../../apps/api/src/gmail-oauth.ts).
- Adds only `https://www.googleapis.com/auth/calendar.readonly`.
- `GOOGLE_SCOPES` = Gmail read/compose **+** Calendar read, so a single re-consent
  covers both. Connecting Calendar stores the resulting refresh token under both
  `gmail` and `google-calendar`, preserving the Gmail connection.
- No event write/delete scope is ever requested.

## Per-user connection

Calendar credentials are owned by the authenticated user (server-side session, never
client-provided `user_id`). Connection states: `connected`, `needs_reauth`,
`disconnected`, `error` (represented in [`connections.ts`](../../apps/api/src/connections.ts)
via `connected` + `needsReauth`). Secrets are AES-256-GCM encrypted at rest.

## Provider & normalization

[`GoogleCalendarProvider`](../../packages/core/src/calendar/calendar-provider.ts) implements
`listEvents(window)` + `getEvent(eventId)` (read-only) and normalizes to:
`providerEventId`, `calendarId`, `title`, `description`, `startAt`, `endAt`, `timezone`,
`organizerEmail`, `attendees[]` (with response status), `meetingUrl`, `status`,
`updatedAt`, `recurringEventId`. No unnecessary data is stored.

## Database & sync

`calendar_events` (id, user_id, provider, provider_event_id, calendar_id, title,
start_at, end_at, organizer_email, attendees jsonb, meeting_url, status,
provider_updated_at, synced_at, created_at, updated_at) with a unique
`(user_id, provider, calendar_id, provider_event_id)` — repeated syncs upsert, never
duplicate. Sync (`POST /integrations/google-calendar/sync`) refreshes 48h past + 48h
upcoming and handles new / updated / rescheduled / cancelled / recurring occurrences;
it never deletes history when an event leaves the current page. Background automation
lands in Step 50.6.

## Frontend

Settings → Integrations has a Google Calendar card: Connected / Needs reauthorization /
Disconnected, "Sync now", and "Connect Calendar". Helper copy states Calendar is for
meeting context and that Revenue Execution OS does not record meetings. No Record /
Capture / Send bot / Add Fireflies / Join meeting controls exist.

## Smoke & tests

- `npm run smoke:calendar` — read-only, lists a few sanitized events (no descriptions).
- [`calendar-provider.test.ts`](../../packages/core/src/__tests__/calendar-provider.test.ts)
  covers normalization (attendees, meeting link, cancelled, recurring, all-day,
  missing fields) and read-only shape.

---

## MANUAL CHECKPOINT 50.4

1. **Google Cloud (one-time, only if not already done):** in the existing OAuth client,
   add `https://www.googleapis.com/auth/calendar.readonly` (it is *not* enabled by
   default just because Gmail works). Also ensure the redirect URI
   `http://localhost:3000/integrations/google-calendar/oauth/callback` is listed under
   **Authorized redirect URIs** for that client.
2. **Consent:** in the UI → Settings → Integrations → Google Calendar, click
   **Connect Calendar**; Google will show a new consent screen including "See your
   primary Google Account calendar events". Approve it.
3. **UI after consent:** the Calendar card should show **Connected** (green badge).
   Existing Gmail remains connected.
4. **Sync:** click **Sync now** — it should succeed; then check the database:
   `SELECT count(*) FROM calendar_events WHERE user_id = '<your user id>';` should be
   non-zero (events from the last/next 48h).
5. **Read-only check (CLI):** run `npm run smoke:calendar` and confirm it prints a few
   sanitized event titles (no descriptions) and never errors with a "forbidden write"
   scope.