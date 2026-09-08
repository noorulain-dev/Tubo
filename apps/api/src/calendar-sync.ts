import { GoogleCalendarProvider } from "./core.js";
import { getPool } from "./db.js";
import { getCalendarRefreshToken } from "./connections.js";
import { exchangeGmailRefreshToken } from "./gmail-oauth.js";

export interface CalendarSyncResult {
  synced: number;
  window: { start: string; end: string };
}

/**
 * Synchronously refresh a window (48h past + 48h upcoming) of the user's Google
 * Calendar into `calendar_events`. Upserts by (user, provider, calendar, event)
 * so new/updated/rescheduled/cancelled/recurring occurrences are handled and
 * history is never deleted when an event leaves the current page.
 */
export async function syncCalendar(userId: string): Promise<CalendarSyncResult> {
  const refreshToken = await getCalendarRefreshToken(userId);
  if (!refreshToken) throw new Error("Google Calendar is not connected");

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth client is not configured");

  const { accessToken } = await exchangeGmailRefreshToken({ clientId, clientSecret, refreshToken });
  const provider = new GoogleCalendarProvider({ accessToken });

  const end = new Date(Date.now() + 48 * 3600 * 1000);
  const start = new Date(Date.now() - 48 * 3600 * 1000);
  const events = await provider.listEvents({ start, end });

  const pool = getPool();
  for (const e of events) {
    await pool.query(
      `INSERT INTO calendar_events
         (id, user_id, provider, provider_event_id, calendar_id, title, start_at, end_at,
          organizer_email, attendees, meeting_url, status, provider_updated_at, synced_at, updated_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, now(), now())
       ON CONFLICT (user_id, provider, calendar_id, provider_event_id)
       DO UPDATE SET
         title = EXCLUDED.title,
         start_at = EXCLUDED.start_at,
         end_at = EXCLUDED.end_at,
         organizer_email = EXCLUDED.organizer_email,
         attendees = EXCLUDED.attendees,
         meeting_url = EXCLUDED.meeting_url,
         status = EXCLUDED.status,
         provider_updated_at = EXCLUDED.provider_updated_at,
         synced_at = now(),
         updated_at = now()`,
      [
        `${userId}:${e.providerEventId}`,
        userId,
        "google",
        e.providerEventId,
        e.calendarId,
        e.title,
        e.startAt,
        e.endAt,
        e.organizerEmail,
        JSON.stringify(e.attendees),
        e.meetingUrl,
        e.status,
        e.updatedAt,
      ],
    );
  }

  return { synced: events.length, window: { start: start.toISOString(), end: end.toISOString() } };
}
