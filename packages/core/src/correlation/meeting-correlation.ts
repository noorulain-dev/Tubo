/**
 * Conservative identity/correlation for automatically ingested meeting
 * artifacts. Pure, deterministic functions — no AI, no chain-of-thought stored.
 */
import type { ResolutionState } from "../enums.js";

export type CalendarCorrelation = "resolved" | "ambiguous" | "unresolved";

export interface CalendarEventInput {
  providerEventId: string;
  title: string | null;
  startAt: string | null;
  endAt: string | null;
  organizerEmail: string | null;
  attendees: string[];
  meetingUrl: string | null;
}

export interface MeetingInput {
  providerMeetingId: string;
  title: string | null;
  startedAt: string | null;
  endedAt: string | null;
  organizer: string | null;
  participants: string[];
  meetingUrl: string | null;
  calendarEventId?: string | null;
}

export interface ContactInput {
  id: string;
  email: string | null;
  accountId?: string | null;
}

export interface CompanyInput {
  id: string;
  domain?: string | null;
}

export interface DealInput {
  id: string;
  accountId?: string | null;
  stage?: string | null;
}

export interface HubSpotIdentityInput {
  contacts: ContactInput[];
  companies: CompanyInput[];
  deals: DealInput[];
  internalEmails: string[];
}

export interface ResolutionResult {
  state: ResolutionState;
  resolved?: { contactId?: string; companyId?: string; dealId?: string; calendarEventId?: string };
  candidates?: Partial<{ contactId: string; companyId: string; dealId: string }>[];
  evidence: string[];
  reasonCode: string;
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function normalizeMeetingUrl(url: string | null | undefined): string {
  if (!url) return "";
  return url.trim().replace(/\/$/, "").replace(/^https?:\/\//, "").toLowerCase();
}

export function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null;
}

function timeOverlaps(aStart: string | null, aEnd: string | null, bStart: string | null, bEnd: string | null): boolean {
  if (!aStart || !bStart) return false;
  const as = new Date(aStart).getTime();
  const ae = aEnd ? new Date(aEnd).getTime() : as;
  const bs = new Date(bStart).getTime();
  const be = bEnd ? new Date(bEnd).getTime() : bs;
  return as < be && bs < ae;
}

function participantOverlap(meeting: string[], event: string[]): number {
  const m = new Set(meeting.map(normalizeEmail));
  const e = new Set(event.map(normalizeEmail));
  let n = 0;
  for (const x of m) if (e.has(x)) n += 1;
  return n;
}

/**
 * Correlate a Fireflies meeting to a Calendar event using strongest evidence
 * first: provider event id → exact meeting URL → organizer + time + participants.
 * Title alone is never authoritative.
 */
export function correlateCalendar(meeting: MeetingInput, events: CalendarEventInput[]): {
  result: CalendarCorrelation;
  eventId: string | null;
  evidence: string[];
} {
  // Tier 1: explicit calendar event id.
  if (meeting.calendarEventId) {
    const byId = events.filter((e) => e.providerEventId === meeting.calendarEventId);
    if (byId.length === 1) return { result: "resolved", eventId: byId[0].providerEventId, evidence: ["calendar_event_id"] };
    if (byId.length > 1) return { result: "ambiguous", eventId: null, evidence: ["calendar_event_id_multiple"] };
  }

  // Tier 2: exact normalized meeting URL.
  const url = normalizeMeetingUrl(meeting.meetingUrl);
  if (url) {
    const byUrl = events.filter((e) => normalizeMeetingUrl(e.meetingUrl) === url);
    if (byUrl.length === 1) return { result: "resolved", eventId: byUrl[0].providerEventId, evidence: ["meeting_url"] };
    if (byUrl.length > 1) return { result: "ambiguous", eventId: null, evidence: ["meeting_url_multiple"] };
  }

  // Tier 3: organizer + time overlap + strong participant overlap.
  const organizer = normalizeEmail(meeting.organizer);
  const matches = events.filter((e) => {
    const sameOrg = organizer && normalizeEmail(e.organizerEmail) === organizer;
    const overlap = timeOverlaps(meeting.startedAt, meeting.endedAt, e.startAt, e.endAt);
    const overlapCount = participantOverlap(meeting.participants, e.attendees);
    return (sameOrg || overlap) && overlapCount > 0;
  });
  if (matches.length === 1) return { result: "resolved", eventId: matches[0].providerEventId, evidence: ["organizer_time_participants"] };
  if (matches.length > 1) return { result: "ambiguous", eventId: null, evidence: ["multiple_overlapping_events"] };

  return { result: "unresolved", eventId: null, evidence: [] };
}

/**
 * Resolve the customer identity for a meeting from HubSpot records. Exact email
 * match is strongest; domain is discovery evidence only (never sufficient on
 * its own when ambiguous). Internal/self emails are excluded from candidates.
 */
export function resolveIdentity(meeting: MeetingInput, hubspot: HubSpotIdentityInput): ResolutionResult {
  const internal = new Set(hubspot.internalEmails.map(normalizeEmail));
  const organizer = normalizeEmail(meeting.organizer);

  const customerParticipants = [
    ...new Set([...(meeting.participants ?? []).map(normalizeEmail), organizer].filter((e) => e && !internal.has(e))),
  ];
  const evidence: string[] = [];

  if (customerParticipants.length === 0) {
    return { state: "missing_context", evidence: ["no_customer_participants"], reasonCode: "no_external_identity" };
  }

  // Exact email → contact.
  const contacts = hubspot.contacts
    .map((c) => ({ ...c, email: normalizeEmail(c.email) }))
    .filter((c) => c.email && customerParticipants.includes(c.email));
  if (contacts.length > 0) {
    const contactEmails = new Set(contacts.map((c) => c.email));
    const participantDomains = new Set(customerParticipants.map(domainOf).filter(Boolean));
    if (contacts.length === 1) {
      const contact = contacts[0];
      const company = hubspot.companies.find((c) => c.id === contact.accountId);
      const deal = company ? hubspot.deals.find((d) => d.accountId === company.id) : undefined;
      return {
        state: "resolved",
        resolved: { contactId: contact.id, companyId: company?.id, dealId: deal?.id },
        evidence: ["exact_email_match", contact.email as string],
        reasonCode: "exact_email",
      };
    }
    // multiple contacts → ambiguous
    return {
      state: "ambiguous",
      candidates: contacts.map((c) => ({ contactId: c.id, companyId: c.accountId ?? undefined })),
      evidence: ["multiple_contact_matches", ...contactEmails],
      reasonCode: "multiple_contacts",
    };
  }

  // Domain discovery (weak, never authoritative).
  const domains = new Set(customerParticipants.map(domainOf).filter(Boolean));
  const domainCompanies = hubspot.companies.filter((c) => c.domain && domains.has(c.domain.toLowerCase()));
  if (domainCompanies.length === 1) {
    evidence.push("domain_discovery", domainCompanies[0].domain as string);
    return { state: "ambiguous", candidates: domainCompanies.map((c) => ({ companyId: c.id })), evidence, reasonCode: "domain_only" };
  }
  if (domainCompanies.length > 1) {
    return { state: "ambiguous", candidates: domainCompanies.map((c) => ({ companyId: c.id })), evidence: ["multiple_domain_companies"], reasonCode: "multiple_domains" };
  }

  return { state: "missing_context", evidence: ["no_identity_evidence"], reasonCode: "no_match" };
}
