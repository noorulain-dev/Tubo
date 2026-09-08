import { describe, expect, it } from "vitest";
import { applyEvent, EMPTY_SNAPSHOT, type AccountEvent } from "../account-intelligence.js";

function evt(eventType: AccountEvent["eventType"], occurredAt: string, payload: Record<string, unknown> = {}, provenance: string | null = null): AccountEvent {
  return {
    eventId: "e",
    userId: "u1",
    accountId: "acct",
    eventType,
    occurredAt,
    source: "test",
    sourceReference: null,
    payload,
    provenance,
  };
}

describe("applyEvent (pure state derivation)", () => {
  it("increments version and prepends recent events (append-only)", () => {
    const s1 = applyEvent(EMPTY_SNAPSHOT, evt("interaction_processed", "2026-01-01T00:00:00Z"));
    expect(s1.version).toBe(1);
    expect(s1.recentEvents[0].eventType).toBe("interaction_processed");

    const s2 = applyEvent(s1, evt("crm_state_observed", "2026-01-02T00:00:00Z", { stage: "Trial" }));
    expect(s2.version).toBe(2);
    expect(s2.recentEvents[0].eventType).toBe("crm_state_observed");
    expect(s2.stage).toBe("Trial");
  });

  it("records commercial state with provenance and last source refresh", () => {
    const s = applyEvent(EMPTY_SNAPSHOT, evt("commercial_state_observed", "2026-01-03T00:00:00Z", { status: "active" }, "hubspot_property_mapping:deal:revexec_billing_status"));
    expect(s.commercial?.status).toBe("active");
    expect(s.commercial?.provenance).toContain("hubspot_property_mapping");
    expect(s.lastSourceRefresh).toBe("2026-01-03T00:00:00Z");
  });

  it("sets lastReviewed on approval", () => {
    const s = applyEvent(EMPTY_SNAPSHOT, evt("proposal_approved", "2026-01-04T00:00:00Z"));
    expect(s.lastReviewed).toBe("2026-01-04T00:00:00Z");
  });

  it("never erases history (recentEvents is capped but non-destructive)", () => {
    let s = EMPTY_SNAPSHOT;
    for (let i = 0; i < 60; i++) s = applyEvent(s, evt("interaction_processed", `2026-01-01T00:0${(i % 10)}:00Z`));
    expect(s.version).toBe(60);
    expect(s.recentEvents.length).toBe(50); // capped
  });
});
