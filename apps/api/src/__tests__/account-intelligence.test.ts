import { describe, expect, it } from "vitest";
import {
  buildState,
  EMPTY_SNAPSHOT,
  reduceEvent,
  type AccountEvent,
  type AccountEventType,
  type AccountIntelligenceSnapshot,
} from "../state-builder.js";

function evt(
  eventType: AccountEventType,
  occurredAt: string,
  payload: Record<string, unknown> = {},
  opts: { eventId?: string; source?: string | null; sourceReference?: string | null; provenance?: string | null } = {},
): AccountEvent {
  return {
    eventId: opts.eventId ?? `${eventType}_${occurredAt}`,
    userId: "u1",
    accountId: "acct",
    eventType,
    occurredAt,
    source: opts.source ?? "test",
    sourceReference: opts.sourceReference ?? null,
    payload,
    provenance: opts.provenance ?? null,
  };
}

function commitment(action: string, opts: { id?: string; owner?: string | null; resolution?: string; deadlineValue?: string | null } = {}) {
  return {
    id: opts.id,
    action,
    owner: opts.owner ?? null,
    resolution: opts.resolution ?? "resolved",
    deadline: opts.deadlineValue !== undefined ? { text: "Friday", kind: "exact", value: opts.deadlineValue, resolution: "resolved" } : null,
    evidence: [],
  };
}

describe("State Builder (buildState / reduceEvent)", () => {
  it("meeting commitment -> task created -> later completion", () => {
    const events = [
      evt("meeting_processed", "2026-09-01T10:00:00Z", {
        semantic: { confirmedCommitments: [commitment("Send security documentation", { id: "c1", owner: "Alex" })] },
      }),
      evt("task_created", "2026-09-01T11:00:00Z", { taskId: "task_1", commitmentId: "c1" }),
      evt("task_completed", "2026-09-03T09:00:00Z", { taskId: "task_1" }),
    ];
    const s = buildState(events);
    const c = s.commitments.find((x) => x.id === "c1")!;
    expect(c.status).toBe("fulfilled");
    expect(c.linkedTaskId).toBe("task_1");
    expect(c.fulfillment?.source).toBe("tasks");
  });

  it("does not duplicate a commitment when an equivalent HubSpot task already exists", () => {
    const events = [
      evt("meeting_processed", "2026-09-01T10:00:00Z", {
        semantic: { confirmedCommitments: [commitment("Send security documentation", { owner: "Alex" })] },
      }),
      evt("meeting_processed", "2026-09-02T10:00:00Z", {
        semantic: { confirmedCommitments: [commitment("Send security documentation", { owner: "Alex" })] },
      }),
    ];
    const s = buildState(events);
    expect(s.commitments.length).toBe(1); // linked, not duplicated
  });

  it("customer question -> later answer", () => {
    const events = [
      evt("manual_interaction_processed", "2026-09-01T10:00:00Z", {
        semantic: { questions: [{ id: "q1", text: "When will pricing be available?" }] },
      }),
      evt("manual_interaction_processed", "2026-09-02T10:00:00Z", {
        semantic: { answers: [{ questionId: "q1", text: "Pricing is available now" }] },
      }),
    ];
    const s = buildState(events);
    expect(s.questions.length).toBe(1);
    expect(s.questions[0].status).toBe("answered");
    expect(s.questions[0].answer?.text).toBe("Pricing is available now");
  });

  it("commercial active -> CRM stage remains Trial (separate authoritative fields)", () => {
    const events = [
      evt("commercial_state_observed", "2026-09-01T10:00:00Z", { status: "active" }),
      evt("crm_state_observed", "2026-09-01T11:00:00Z", { stage: "Trial" }),
    ];
    const s = buildState(events);
    expect(s.commercial?.status).toBe("active");
    expect(s.stage).toBe("Trial"); // CRM stage preserved, not overwritten
  });

  it("ambiguous commitment -> later owner resolution", () => {
    const events = [
      evt("meeting_processed", "2026-09-01T10:00:00Z", {
        semantic: { confirmedCommitments: [commitment("Draft proposal", { id: "c1", owner: null, resolution: "ambiguous" })] },
      }),
      evt("manual_correction", "2026-09-02T10:00:00Z", {
        ownerResolutions: [{ commitmentId: "c1", owner: "Sam" }],
      }),
    ];
    const s = buildState(events);
    const c = s.commitments.find((x) => x.id === "c1")!;
    expect(c.owner).toBe("Sam");
    expect(c.status).toBe("open");
  });

  it("does not infer owner from vague 'we' language", () => {
    const events = [
      evt("meeting_processed", "2026-09-01T10:00:00Z", {
        semantic: { confirmedCommitments: [commitment("we should follow up", { owner: null, resolution: "missing_context" })] },
      }),
    ];
    const s = buildState(events);
    expect(s.commitments[0].owner).toBeNull();
    expect(s.commitments[0].ownerResolution).toBe("missing_context");
  });

  it("newer authoritative evidence supersedes older latest fact, history preserved", () => {
    const events = [
      evt("commercial_state_observed", "2026-09-01T10:00:00Z", { status: "trial" }),
      evt("commercial_state_observed", "2026-09-05T10:00:00Z", { status: "active" }),
    ];
    const s = buildState(events);
    expect(s.commercial?.status).toBe("active"); // newer supersedes
    expect(s.recentEvents.length).toBe(2); // both preserved in ledger
  });

  it("does not let conversational intent overwrite authoritative commercial state", () => {
    const events = [
      evt("commercial_state_observed", "2026-09-01T10:00:00Z", { status: "trial" }),
      evt("manual_interaction_processed", "2026-09-02T10:00:00Z", {
        semantic: { confirmedCommitments: [], commercialSignals: [{ kind: "intent", text: "we just upgraded", resolution: "resolved", evidence: [] }] },
      }),
    ];
    const s = buildState(events);
    expect(s.commercial?.status).toBe("trial"); // conversation is evidence, not truth
  });

  it("deduplicates events by eventId (duplicate event folds to same state)", () => {
    const e = evt("crm_state_observed", "2026-09-01T10:00:00Z", { stage: "Trial" }, { eventId: "dup" });
    const s = buildState([e, e, e]);
    expect(s.version).toBe(1);
    expect(s.stage).toBe("Trial");
  });

  it("out-of-order events fold deterministically (sorted by occurredAt)", () => {
    const early = evt("commercial_state_observed", "2026-09-01T10:00:00Z", { status: "trial" });
    const late = evt("commercial_state_observed", "2026-09-05T10:00:00Z", { status: "active" });
    const ordered = buildState([early, late]);
    const shuffled = buildState([late, early]);
    expect(shuffled.commercial?.status).toBe(ordered.commercial?.status);
    expect(shuffled.commercial?.status).toBe("active");
  });

  it("provider unavailable -> no guess, marks source unavailable", () => {
    const events = [evt("commercial_state_observed", "2026-09-01T10:00:00Z", { unavailable: true })];
    const s = buildState(events);
    expect(s.commercial).toBeNull(); // not guessed
    expect(s.unavailableSources).toContain("commercial");
  });

  it("increments version per unique event and prepends recent events", () => {
    const s1 = reduceEvent(EMPTY_SNAPSHOT, evt("interaction_processed", "2026-01-01T00:00:00Z"));
    expect(s1.version).toBe(1);
    expect(s1.recentEvents[0].eventType).toBe("interaction_processed");
  });

  it("rebuild from empty is reproducible", () => {
    const events = [
      evt("crm_state_observed", "2026-09-01T10:00:00Z", { stage: "Trial" }),
      evt("commercial_state_observed", "2026-09-01T11:00:00Z", { status: "active" }),
    ];
    const a = buildState(events) as AccountIntelligenceSnapshot;
    const b = buildState(events) as AccountIntelligenceSnapshot;
    expect(a).toEqual(b);
  });
});
