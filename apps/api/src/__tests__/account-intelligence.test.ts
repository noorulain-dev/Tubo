import { describe, expect, it } from "vitest";
import {
  buildState,
  EMPTY_SNAPSHOT,
  reduceEvent,
  type AccountEvent,
  type AccountEventType,
} from "../accounts/state-builder.js";

function evt(
  eventType: AccountEventType,
  occurredAt: string,
  payload: Record<string, unknown> = {},
  opts: { eventId?: string; source?: string | null; sourceReference?: string | null } = {},
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
    provenance: null,
  };
}

function commitment(
  action: string,
  opts: {
    id?: string;
    owner?: string | null;
    resolution?: string;
    deadlineValue?: string | null;
    deadlineKind?: string;
  } = {},
) {
  const deadline =
    opts.deadlineValue !== undefined || opts.deadlineKind
      ? {
          text: "Friday",
          kind: opts.deadlineKind ?? "exact",
          value: opts.deadlineValue ?? null,
          resolution: opts.deadlineKind === "ambiguous" ? "ambiguous" : "resolved",
        }
      : null;
  return {
    id: opts.id,
    action,
    owner: opts.owner ?? null,
    resolution: opts.resolution ?? "resolved",
    deadline,
    evidence: [],
  };
}

function question(text: string, id?: string, resolution?: string) {
  return { id, text, resolution: resolution ?? "resolved" };
}

describe("Commitment lifecycle", () => {
  it("open -> fulfilled via reliably-linked task completion", () => {
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
    expect(c.relatedTaskIds).toContain("task_1");
    expect(c.fulfillment?.source).toBe("tasks");
  });

  it("open -> fulfilled via outbound Gmail evidence carrying the artifact", () => {
    const events = [
      evt("meeting_processed", "2026-09-01T10:00:00Z", {
        semantic: { confirmedCommitments: [commitment("Send security documentation", { id: "c1", owner: "Alex" })] },
      }),
      evt("email_observed", "2026-09-02T10:00:00Z", {
        commitmentId: "c1",
        delivered: true,
        reference: "msg_123",
      }),
    ];
    const s = buildState(events);
    const c = s.commitments.find((x) => x.id === "c1")!;
    expect(c.status).toBe("fulfilled");
    expect(c.relatedEmailIds).toContain("msg_123");
  });

  it("does NOT fulfil on a vaguely-similar email without an explicit link", () => {
    const events = [
      evt("meeting_processed", "2026-09-01T10:00:00Z", {
        semantic: { confirmedCommitments: [commitment("Send security documentation", { id: "c1", owner: "Alex" })] },
      }),
      // Unrelated email — no commitmentId / description match, no delivery flag.
      evt("email_observed", "2026-09-02T10:00:00Z", { subject: "fyi", body: "just checking in" }),
    ];
    const s = buildState(events);
    expect(s.commitments.find((x) => x.id === "c1")!.status).toBe("open");
  });

  it("open -> overdue via deterministic date comparison", () => {
    const events = [
      evt("meeting_processed", "2026-09-01T10:00:00Z", {
        semantic: { confirmedCommitments: [commitment("Send quote", { id: "c1", owner: "Alex", deadlineValue: "2026-09-05T00:00:00Z" })] },
      }),
    ];
    const s = buildState(events, { now: "2026-09-10T00:00:00Z" });
    expect(s.commitments.find((x) => x.id === "c1")!.status).toBe("overdue");
  });

  it("open -> blocked via manual correction", () => {
    const events = [
      evt("meeting_processed", "2026-09-01T10:00:00Z", {
        semantic: { confirmedCommitments: [commitment("Send quote", { id: "c1", owner: "Alex" })] },
      }),
      evt("manual_correction", "2026-09-02T10:00:00Z", { commitmentUpdates: [{ commitmentId: "c1", status: "blocked" }] }),
    ];
    const s = buildState(events);
    expect(s.commitments.find((x) => x.id === "c1")!.status).toBe("blocked");
  });

  it("tracks conditional commitments with their condition", () => {
    const events = [
      evt("meeting_processed", "2026-09-01T10:00:00Z", {
        semantic: {
          conditionalCommitments: [
            { id: "c1", action: "Expand to EU", condition: "if budget is approved", owner: "Alex", resolution: "resolved", deadline: null, evidence: [] },
          ],
        },
      }),
    ];
    const s = buildState(events);
    const c = s.commitments.find((x) => x.id === "c1")!;
    expect(c.condition).toBe("if budget is approved");
    expect(c.status).toBe("open");
  });

  it("does not promote tentative 'we should…' candidate commitments", () => {
    const events = [
      evt("meeting_processed", "2026-09-01T10:00:00Z", {
        semantic: { candidateCommitments: [commitment("we should follow up", { owner: null, resolution: "ambiguous" })] },
      }),
    ];
    const s = buildState(events);
    expect(s.commitments.length).toBe(0);
  });

  it("ambiguous owner -> not invented, status ambiguous", () => {
    const events = [
      evt("meeting_processed", "2026-09-01T10:00:00Z", {
        semantic: { confirmedCommitments: [commitment("Draft proposal", { id: "c1", owner: null, resolution: "ambiguous" })] },
      }),
    ];
    const s = buildState(events);
    const c = s.commitments.find((x) => x.id === "c1")!;
    expect(c.owner).toBeNull();
    expect(c.ownerResolution).toBe("ambiguous");
    expect(c.status).toBe("ambiguous");
  });

  it("ambiguous date -> dueDate null, not overdue", () => {
    const events = [
      evt("meeting_processed", "2026-09-01T10:00:00Z", {
        semantic: { confirmedCommitments: [commitment("Send quote", { id: "c1", owner: "Alex", deadlineKind: "ambiguous" })] },
      }),
    ];
    const s = buildState(events, { now: "2026-09-10T00:00:00Z" });
    const c = s.commitments.find((x) => x.id === "c1")!;
    expect(c.dueDate).toBeNull();
    expect(c.dueDateResolution).toBe("ambiguous");
    expect(c.status).toBe("ambiguous"); // never coerced to overdue
  });

  it("similar but different commitments are NOT merged", () => {
    const events = [
      evt("meeting_processed", "2026-09-01T10:00:00Z", {
        semantic: {
          confirmedCommitments: [commitment("Send pricing quote", { owner: "Alex" }), commitment("Send final quote", { owner: "Alex" })],
        },
      }),
    ];
    const s = buildState(events);
    expect(s.commitments.length).toBe(2);
  });

  it("does not duplicate an equivalent commitment across events", () => {
    const events = [
      evt("meeting_processed", "2026-09-01T10:00:00Z", {
        semantic: { confirmedCommitments: [commitment("Send quote", { owner: "Alex" })] },
      }),
      evt("meeting_processed", "2026-09-02T10:00:00Z", {
        semantic: { confirmedCommitments: [commitment("Send quote", { owner: "Alex" })] },
      }),
    ];
    const s = buildState(events);
    expect(s.commitments.length).toBe(1);
  });
});

describe("Customer questions", () => {
  it("tracks an open customer question", () => {
    const events = [
      evt("manual_interaction_processed", "2026-09-01T10:00:00Z", {
        semantic: { questions: [question("When will pricing be available?", "q1")] },
      }),
    ];
    const s = buildState(events);
    expect(s.questions.length).toBe(1);
    expect(s.questions[0].status).toBe("open");
  });

  it("question answered by later email", () => {
    const events = [
      evt("manual_interaction_processed", "2026-09-01T10:00:00Z", {
        semantic: { questions: [question("When will pricing be available?", "q1")] },
      }),
      evt("email_observed", "2026-09-02T10:00:00Z", {
        answers: [{ questionId: "q1", text: "Pricing is available starting today" }],
      }),
    ];
    const s = buildState(events);
    expect(s.questions[0].status).toBe("answered");
    expect(s.questions[0].answer?.source).toBe("gmail");
    expect(s.questions[0].answeredAt).toBe("2026-09-02T10:00:00Z");
  });

  it("irrelevant email does NOT answer a question", () => {
    const events = [
      evt("manual_interaction_processed", "2026-09-01T10:00:00Z", {
        semantic: { questions: [question("When will pricing be available?", "q1")] },
      }),
      evt("email_observed", "2026-09-02T10:00:00Z", { subject: "unrelated", body: "thanks for the call" }),
    ];
    const s = buildState(events);
    expect(s.questions[0].status).toBe("open");
  });

  it("deduplicates the same question", () => {
    const events = [
      evt("manual_interaction_processed", "2026-09-01T10:00:00Z", {
        semantic: { questions: [question("When will pricing be available?")] },
      }),
      evt("manual_interaction_processed", "2026-09-02T10:00:00Z", {
        semantic: { questions: [question("When will pricing be available?")] },
      }),
    ];
    const s = buildState(events);
    expect(s.questions.length).toBe(1);
  });

  it("marks a question obsolete via manual correction", () => {
    const events = [
      evt("manual_interaction_processed", "2026-09-01T10:00:00Z", {
        semantic: { questions: [question("When will pricing be available?", "q1")] },
      }),
      evt("manual_correction", "2026-09-03T10:00:00Z", { questionUpdates: [{ questionId: "q1", status: "obsolete" }] }),
    ];
    const s = buildState(events);
    expect(s.questions[0].status).toBe("obsolete");
  });
});

describe("determinism and reducers", () => {
  it("deduplicates events by eventId", () => {
    const e = evt("crm_state_observed", "2026-09-01T10:00:00Z", { stage: "Trial" }, { eventId: "dup" });
    const s = buildState([e, e, e]);
    expect(s.version).toBe(1);
  });

  it("out-of-order events fold deterministically", () => {
    const early = evt("commercial_state_observed", "2026-09-01T10:00:00Z", { status: "trial" });
    const late = evt("commercial_state_observed", "2026-09-05T10:00:00Z", { status: "active" });
    expect(buildState([late, early]).commercial?.status).toBe("active");
  });

  it("commercial active -> CRM stage preserved separately", () => {
    const s = buildState([
      evt("commercial_state_observed", "2026-09-01T10:00:00Z", { status: "active" }),
      evt("crm_state_observed", "2026-09-01T11:00:00Z", { stage: "Trial" }),
    ]);
    expect(s.commercial?.status).toBe("active");
    expect(s.stage).toBe("Trial");
  });

  it("increments version per unique event", () => {
    const s = reduceEvent(EMPTY_SNAPSHOT, evt("interaction_processed", "2026-01-01T00:00:00Z"));
    expect(s.version).toBe(1);
    expect(s.recentEvents[0].eventType).toBe("interaction_processed");
  });
});
