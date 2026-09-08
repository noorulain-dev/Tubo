import { AuthenticationError, ProviderError, RateLimitError } from "../errors.js";

/** A normalized, read-only calendar event. */
export interface CalendarEvent {
  providerEventId: string;
  calendarId: string;
  title: string | null;
  description: string | null;
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  organizerEmail: string | null;
  attendees: { email: string; responseStatus: string | null }[];
  meetingUrl: string | null;
  status: string;
  updatedAt: string | null;
  recurringEventId: string | null;
}

export interface CalendarEventWindow {
  start: Date;
  end: Date;
}

export interface CalendarReadProvider {
  listEvents(window: CalendarEventWindow): Promise<CalendarEvent[]>;
  getEvent(eventId: string): Promise<CalendarEvent | null>;
}

export interface GoogleCalendarClientOptions {
  accessToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  calendarId?: string;
}

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email?: string };
  attendees?: { email?: string; responseStatus?: string }[];
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { uri?: string }[] };
  status?: string;
  updated?: string;
  recurringEventId?: string;
}

/** Pick a date-time (falling back to an all-day `date` value). */
function eventTime(v: { dateTime?: string; date?: string } | undefined): string | null {
  if (!v) return null;
  return v.dateTime ?? v.date ?? null;
}

function meetingUrl(e: GoogleEvent): string | null {
  if (e.hangoutLink) return e.hangoutLink;
  const uri = e.conferenceData?.entryPoints?.find((x) => x.uri)?.uri;
  return uri ?? null;
}

export function normalizeCalendarEvent(raw: GoogleEvent, calendarId: string): CalendarEvent {
  return {
    providerEventId: raw.id,
    calendarId,
    title: raw.summary ?? null,
    description: raw.description ?? null,
    startAt: eventTime(raw.start),
    endAt: eventTime(raw.end),
    timezone: raw.start?.timeZone ?? null,
    organizerEmail: raw.organizer?.email ?? null,
    attendees: (raw.attendees ?? []).map((a) => ({ email: a.email ?? "", responseStatus: a.responseStatus ?? null })),
    meetingUrl: meetingUrl(raw),
    status: raw.status ?? "unknown",
    updatedAt: raw.updated ?? null,
    recurringEventId: raw.recurringEventId ?? null,
  };
}

/**
 * Read-only Google Calendar provider. There is deliberately no write, create,
 * delete, or "record meeting" capability — only event listing/reads for context.
 */
export class GoogleCalendarProvider implements CalendarReadProvider {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly calendarId: string;

  constructor(opts: GoogleCalendarClientOptions) {
    this.accessToken = opts.accessToken;
    this.baseUrl = (opts.baseUrl ?? "https://www.googleapis.com/calendar/v3").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.calendarId = opts.calendarId ?? "primary";
  }

  async listEvents(window: CalendarEventWindow): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
      timeMin: window.start.toISOString(),
      timeMax: window.end.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
    });
    const res = await this.request(`/calendars/${encodeURIComponent(this.calendarId)}/events?${params.toString()}`);
    const data = (await res.json()) as { items?: GoogleEvent[] };
    return (data.items ?? []).map((e) => normalizeCalendarEvent(e, this.calendarId));
  }

  async getEvent(eventId: string): Promise<CalendarEvent | null> {
    try {
      const res = await this.request(`/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(eventId)}`);
      return normalizeCalendarEvent((await res.json()) as GoogleEvent, this.calendarId);
    } catch (err) {
      if (err instanceof ProviderError && (err.details as { notFound?: boolean } | undefined)?.notFound) return null;
      throw err;
    }
  }

  private async request(path: string): Promise<Response> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      const status = res.status;
      if (status === 401) throw new AuthenticationError(`Calendar authentication failed (${status})`);
      if (status === 429) throw new RateLimitError(`Calendar rate limited (${status})`);
      if (status === 404) throw new ProviderError("Calendar resource not found", { status: 404, details: { notFound: true } });
      throw new ProviderError(`Calendar request failed (${status})`, { retryable: status >= 500 });
    }
    return res;
  }
}
