import { describe, expect, it } from "vitest";
import { buildCanonicalInteraction } from "../accounts/canonical-interaction.js";
import { ingestMeetingArtifact, type FirefliesIngestDeps } from "../accounts/fireflies-ingest.js";
import type { MeetingArtifact } from "../shared/core.js";

const artifact: MeetingArtifact = {
  provider: "fireflies",
  providerMeetingId: "ff_1",
  title: "Renewal call",
  startedAt: "2026-09-08T14:00:00Z",
  endedAt: "2026-09-08T15:00:00Z",
  organizer: "am@example.com",
  participants: ["am@example.com", "buyer@acme.com"],
  calendarReference: null,
  meetingUrl: "https://meet.google.com/abc",
  transcript: [
    { speaker: "Alex", text: "Hello", ts: 0 },
    { speaker: "Buyer", text: "We want to renew", ts: 1 },
  ],
  summary: "Customer wants to renew.",
  actionItemHints: ["Send renewal quote"],
  providerCreatedAt: "2026-09-08T14:00:00Z",
  providerUpdatedAt: null,
  provenance: "fireflies",
};

describe("buildCanonicalInteraction", () => {
  it("converges a Fireflies artifact into the canonical InteractionInput", () => {
    const { input, source } = buildCanonicalInteraction(artifact, { accountId: "co_1", calendarEventId: "evt_1" });
    expect(input.kind).toBe("meeting");
    expect(input.accountId).toBe("co_1");
    expect(input.text).toContain("Renewal call");
    expect(input.text).toContain("Buyer: We want to renew");
    expect(source.sourceType).toBe("fireflies");
    expect(source.calendarEventId).toBe("evt_1");
    expect(source.actionItemHints).toEqual(["Send renewal quote"]);
  });
});

describe("ingestMeetingArtifact", () => {
  function deps(over: Partial<FirefliesIngestDeps> = {}): FirefliesIngestDeps {
    return {
      process: { process: async () => ({ proposals: [{ status: "pending_approval" }] }) },
      loadArtifact: async () => artifact,
      loadCalendarEvents: async () => [
        { providerEventId: "evt_1", title: "Renewal call", startAt: "2026-09-08T14:00:00Z", endAt: "2026-09-08T15:00:00Z", organizerEmail: "am@example.com", attendees: ["am@example.com", "buyer@acme.com"], meetingUrl: "https://meet.google.com/abc" },
      ],
      loadHubSpotIdentity: async () => ({
        contacts: [{ id: "c1", email: "buyer@acme.com", accountId: "co_1" }],
        companies: [{ id: "co_1", domain: "acme.com" }],
        deals: [{ id: "d1", accountId: "co_1" }],
        internalEmails: ["am@example.com"],
      }),
      ...over,
    };
  }

  it("resolves account and returns needs_review when proposals await approval", async () => {
    const r = await ingestMeetingArtifact("u1", "ff_1", deps());
    expect(r.accountResolved).toBe(true);
    expect(r.status).toBe("needs_review");
  });

  it("returns completed_no_action when resolved and nothing needs approval", async () => {
    const r = await ingestMeetingArtifact("u1", "ff_1", deps({ process: { process: async () => ({ proposals: [] }) } }));
    expect(r.status).toBe("completed_no_action");
  });

  it("returns unresolved_account when identity cannot be resolved", async () => {
    const r = await ingestMeetingArtifact(
      "u1",
      "ff_1",
      deps({ loadHubSpotIdentity: async () => ({ contacts: [], companies: [], deals: [], internalEmails: ["am@example.com"] }) }),
    );
    expect(r.status).toBe("unresolved_account");
  });

  it("returns failed when the artifact is missing", async () => {
    const r = await ingestMeetingArtifact("u1", "ff_1", deps({ loadArtifact: async () => null }));
    expect(r.status).toBe("failed");
  });
});
