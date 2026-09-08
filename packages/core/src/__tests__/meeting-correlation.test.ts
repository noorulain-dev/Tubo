import { describe, expect, it } from "vitest";
import { correlateCalendar, resolveIdentity, type MeetingInput, type CalendarEventInput, type HubSpotIdentityInput } from "../index.js";

const meeting = (over: Partial<MeetingInput> = {}): MeetingInput => ({
  providerMeetingId: "ff_1",
  title: "QBR",
  startedAt: "2026-09-08T14:00:00Z",
  endedAt: "2026-09-08T15:00:00Z",
  organizer: "am@example.com",
  participants: ["am@example.com", "cust@acme.com"],
  meetingUrl: "https://meet.google.com/abc-defg-hij",
  ...over,
});

const event = (over: Partial<CalendarEventInput> = {}): CalendarEventInput => ({
  providerEventId: "evt_1",
  title: "QBR",
  startAt: "2026-09-08T14:00:00Z",
  endAt: "2026-09-08T15:00:00Z",
  organizerEmail: "am@example.com",
  attendees: ["am@example.com", "cust@acme.com"],
  meetingUrl: "https://meet.google.com/abc-defg-hij",
  ...over,
});

describe("correlateCalendar", () => {
  it("resolves by exact calendar event id (strongest)", () => {
    const r = correlateCalendar(meeting({ calendarEventId: "evt_1" }), [event()]);
    expect(r.result).toBe("resolved");
    expect(r.eventId).toBe("evt_1");
  });

  it("resolves by exact normalized meeting URL", () => {
    const r = correlateCalendar(meeting(), [event()]);
    expect(r.result).toBe("resolved");
  });

  it("resolves by organizer + time + participant overlap", () => {
    const e = event({ meetingUrl: null, providerEventId: "evt_2" });
    const r = correlateCalendar(meeting({ meetingUrl: null }), [e]);
    expect(r.result).toBe("resolved");
  });

  it("returns ambiguous with two matching events", () => {
    const r = correlateCalendar(meeting(), [event(), event({ providerEventId: "evt_2" })]);
    expect(r.result).toBe("ambiguous");
  });

  it("returns unresolved when no calendar event matches", () => {
    const r = correlateCalendar(meeting(), [event({ startAt: "2026-09-09T14:00:00Z", meetingUrl: null, organizerEmail: "other@x.com", attendees: [] })]);
    expect(r.result).toBe("unresolved");
  });
});

describe("resolveIdentity", () => {
  const hubspot = (over: Partial<HubSpotIdentityInput> = {}): HubSpotIdentityInput => ({
    contacts: [
      { id: "c1", email: "cust@acme.com", accountId: "co1" },
      { id: "c2", email: "cust2@acme.com", accountId: "co1" },
    ],
    companies: [{ id: "co1", domain: "acme.com" }],
    deals: [{ id: "d1", accountId: "co1", stage: "open" }],
    internalEmails: ["am@example.com"],
    ...over,
  });

  it("resolves exact HubSpot contact to company and deal", () => {
    const r = resolveIdentity(meeting(), hubspot());
    expect(r.state).toBe("resolved");
    expect(r.resolved).toEqual({ contactId: "c1", companyId: "co1", dealId: "d1" });
  });

  it("is ambiguous with multiple matching contacts", () => {
    const r = resolveIdentity(meeting({ participants: ["am@example.com", "cust@acme.com", "cust2@acme.com"] }), hubspot());
    expect(r.state).toBe("ambiguous");
  });

  it("excludes internal/self participants (cross-user identity isolation)", () => {
    const r = resolveIdentity(meeting({ participants: ["am@example.com"], organizer: "am@example.com" }), hubspot());
    expect(r.state).toBe("missing_context");
  });

  it("uses domain as discovery-only (ambiguous) when no exact email", () => {
    const r = resolveIdentity(meeting({ participants: ["am@example.com", "unknown@acme.com"] }), hubspot());
    expect(r.state).toBe("ambiguous");
    expect(r.reasonCode).toBe("domain_only");
  });

  it("returns missing_context when nothing matches", () => {
    const r = resolveIdentity(meeting({ participants: ["am@example.com", "x@nowhere.io"] }), hubspot());
    expect(r.state).toBe("missing_context");
  });
});
