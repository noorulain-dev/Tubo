import { describe, expect, it } from "vitest";
import { GoogleCalendarProvider, normalizeCalendarEvent } from "../index.js";

describe("normalizeCalendarEvent", () => {
  it("maps a full event with attendees, meeting link, and organizer", () => {
    const e = normalizeCalendarEvent(
      {
        id: "evt_1",
        summary: "Quarterly review",
        start: { dateTime: "2026-09-08T14:00:00Z", timeZone: "America/New_York" },
        end: { dateTime: "2026-09-08T15:00:00Z" },
        organizer: { email: "boss@example.com" },
        attendees: [
          { email: "a@example.com", responseStatus: "accepted" },
          { email: "b@example.com", responseStatus: "tentative" },
        ],
        hangoutLink: "https://meet.google.com/abc",
        status: "confirmed",
        updated: "2026-09-07T10:00:00Z",
      },
      "primary",
    );
    expect(e.title).toBe("Quarterly review");
    expect(e.timezone).toBe("America/New_York");
    expect(e.organizerEmail).toBe("boss@example.com");
    expect(e.attendees).toHaveLength(2);
    expect(e.meetingUrl).toBe("https://meet.google.com/abc");
    expect(e.status).toBe("confirmed");
  });

  it("handles cancelled + recurring events", () => {
    const e = normalizeCalendarEvent(
      { id: "evt_2", summary: "Standup", status: "cancelled", recurringEventId: "rec_1" },
      "primary",
    );
    expect(e.status).toBe("cancelled");
    expect(e.recurringEventId).toBe("rec_1");
  });

  it("handles all-day (date-only) events and missing attendees/link", () => {
    const e = normalizeCalendarEvent(
      { id: "evt_3", summary: "Offsite", start: { date: "2026-09-12" }, end: { date: "2026-09-14" } },
      "primary",
    );
    expect(e.startAt).toBe("2026-09-12");
    expect(e.endAt).toBe("2026-09-14");
    expect(e.attendees).toEqual([]);
    expect(e.meetingUrl).toBeNull();
  });

  it("is read-only (implements only listEvents/getEvent)", () => {
    const p = new GoogleCalendarProvider({ accessToken: "x", fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) })) as unknown as typeof fetch });
    expect(typeof (p as { createEvent?: unknown }).createEvent).toBe("undefined");
  });
});