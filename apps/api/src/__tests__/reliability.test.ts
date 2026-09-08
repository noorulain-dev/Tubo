import { describe, expect, it } from "vitest";
import { buildState, reduceEvent, EMPTY_SNAPSHOT, type AccountEvent } from "../accounts/state-builder.js";
import { reconcileFindings, findingKey, type Finding } from "../accounts/risk-scanner.js";

function evt(eventType: AccountEvent["eventType"], occurredAt: string, payload?: Record<string, unknown>): AccountEvent {
  return { eventId: `e_${eventType}_${occurredAt}`, userId: "u1", accountId: "acct", eventType, occurredAt, source: "test", sourceReference: null, payload: payload ?? {}, provenance: null };
}

describe("Account Intelligence reliability", () => {
  it("tolerates a partial event (missing payload) without crashing", () => {
    const partial = { eventId: "p1", userId: "u1", accountId: "acct", eventType: "meeting_processed", occurredAt: "2026-09-01T00:00:00Z", source: null, sourceReference: null, payload: undefined as unknown as Record<string, unknown>, provenance: null } as AccountEvent;
    const s = reduceEvent(EMPTY_SNAPSHOT, partial);
    expect(s.version).toBe(1);
  });

  it("rebuilds deterministically regardless of event input order or duplication", () => {
    const events = [
      evt("crm_state_observed", "2026-09-01T10:00:00Z", { stage: "Trial" }),
      evt("commercial_state_observed", "2026-09-01T11:00:00Z", { status: "active" }),
    ];
    const a = buildState([events[0], events[1], events[0]]);
    const b = buildState([events[1], events[0]]);
    expect(a.stage).toBe(b.stage);
    expect(a.commercial?.status).toBe(b.commercial?.status);
    expect(a.version).toBe(2); // duplicate crm event deduped
  });

  it("tolerates an unknown event type (no switch match)", () => {
    const s = reduceEvent(EMPTY_SNAPSHOT, { ...evt("interaction_processed" as AccountEvent["eventType"], "2026-09-01T00:00:00Z"), eventType: "interaction_processed" as AccountEvent["eventType"] });
    expect(s.version).toBe(1);
  });
});

function finding(type: Finding["type"], id: string, severity: Finding["severity"]): Finding {
  return {
    findingId: id, userId: "u1", accountId: "acct", type, severity, title: `${type} ${id}`, description: "",
    evidence: [], sourceReferences: [], signals: [], needsInvestigation: severity === "critical" || severity === "high",
    status: "open", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", resolvedAt: null,
  };
}

describe("Scanner finding lifecycle reliability", () => {
  it("a new source event creates a finding; a resolved condition removes it", () => {
    const missing = finding("missing_operational_task", findingKey("acct", "missing_operational_task", "t"), "medium");
    // New condition true → finding appears.
    const afterAppear = reconcileFindings([], [missing], "2026-09-01T00:00:00Z");
    expect(afterAppear.find((f) => f.findingId === missing.findingId)?.status).toBe("open");

    // Condition resolved (finding absent from scan) → finding resolves.
    const afterResolve = reconcileFindings(afterAppear, [], "2026-09-02T00:00:00Z");
    const resolved = afterResolve.find((f) => f.findingId === missing.findingId);
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolvedAt).toBe("2026-09-02T00:00:00Z");
  });

  it("repeated scans do not duplicate findings", () => {
    const f = finding("overdue_internal_commitment", findingKey("acct", "overdue_internal_commitment", "x"), "high");
    const first = reconcileFindings([], [f], "2026-09-01T00:00:00Z");
    const second = reconcileFindings(first, [f], "2026-09-02T00:00:00Z");
    expect(second.filter((x) => x.findingId === f.findingId)).toHaveLength(1);
  });
});