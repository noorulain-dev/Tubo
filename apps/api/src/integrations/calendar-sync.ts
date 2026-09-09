import { GoogleCalendarProvider, loadConfig } from "../shared/core.js";
import { getPool } from "../database/db.js";
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

  const clientId = loadConfig().gmailClientId;
  const clientSecret = loadConfig().gmailClientSecret;
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
          all_day, organizer_email, attendees, meeting_url, status, provider_updated_at, synced_at, updated_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, now(), now())
       ON CONFLICT (user_id, provider, calendar_id, provider_event_id)
       DO UPDATE SET
         title = EXCLUDED.title,
         start_at = EXCLUDED.start_at,
         end_at = EXCLUDED.end_at,
         all_day = EXCLUDED.all_day,
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
        e.allDay,
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

export interface CalendarEventView {
  id: string;
  title: string | null;
  startAt: string | null;
  endAt: string | null;
  allDay: boolean;
  meetingUrl: string | null;
  organizerEmail: string | null;
  attendeeCount: number;
  status: string;
}

function iso(v: unknown): string | null {
  return v ? new Date(v as string).toISOString() : null;
}

/** Read persisted calendar events (user-scoped) for a time range. */
export async function listCalendarEvents(userId: string, start: Date, end: Date): Promise<CalendarEventView[]> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT provider_event_id, title, start_at, end_at, all_day, meeting_url, organizer_email, attendees, status
     FROM calendar_events
     WHERE user_id = $1 AND start_at < $3 AND end_at > $2
     ORDER BY start_at`,
    [userId, start.toISOString(), end.toISOString()],
  );
  return (res.rows as Record<string, unknown>[]).map((r) => {
    const attendees = Array.isArray(r.attendees) ? (r.attendees as unknown[]) : [];
    return {
      id: String(r.provider_event_id),
      title: (r.title as string) ?? null,
      startAt: iso(r.start_at),
      endAt: iso(r.end_at),
      allDay: Boolean(r.all_day),
      meetingUrl: (r.meeting_url as string) ?? null,
      organizerEmail: (r.organizer_email as string) ?? null,
      attendeeCount: attendees.length,
      status: String(r.status),
    };
  });
}

/** Most recent calendar sync time for a user (for the "Last sync" health line). */
export async function getCalendarLastSync(userId: string): Promise<string | null> {
  const pool = getPool();
  const res = await pool.query(
    "SELECT MAX(synced_at) AS last_sync FROM calendar_events WHERE user_id = $1",
    [userId],
  );
  const v = (res.rows[0] as { last_sync: string | null } | undefined)?.last_sync;
  return v ? new Date(v).toISOString() : null;
}
