import { describe, expect, it } from "vitest";
import {
  FACT_AUTHORITY,
  SemanticStateSchema,
  detectExecutionGaps,
  reconcile,
  type CommercialState,
  type OperationalContext,
  type SemanticState,
} from "../index.js";

function state(partial: Partial<SemanticState>): SemanticState {
  return SemanticStateSchema.parse({ interactionId: "i1", ...partial });
}

function ctx(overrides: Partial<OperationalContext> = {}): OperationalContext {
  return {
    contacts: [],
    openDeal: null,
    recentNotes: [],
    openTasks: [],
    commercialState: null,
    emailThread: null,
    ...overrides,
  };
}

const activeSub: CommercialState = {
  accountId: "acct",
  trial: { status: "ended" },
  subscription: { status: "active", plan: "pro" },
  commercialException: null,
  provenance: "fixture",
};
const inactiveSub: CommercialState = {
  accountId: "acct",
  trial: { status: "active" },
  subscription: null,
  commercialException: null,
  provenance: "fixture",
};

describe("reconciliation classifications", () => {
  it("MISSING: confirmed commitment with no operational representation", () => {
    const s = state({
      confirmedCommitments: [{ action: "send proposal", owner: "Sarah Chen", evidence: [], resolution: "resolved" }],
    });
    const [f] = reconcile({ state: s, context: ctx() });
    expect(f?.classification).toBe("missing");
    expect(f?.proposedAction?.type).toBe("create_task");
    expect(f?.rationaleCode).toBe("no_operational_representation");
  });

  it("DUPLICATE: equivalent task already exists", () => {
    const s = state({
      confirmedCommitments: [{ action: "send proposal", owner: "Sarah", evidence: [], resolution: "resolved" }],
    });
    const [f] = reconcile({
      state: s,
      context: ctx({ openTasks: [{ id: "t1", title: "Send proposal", type: "EMAIL", status: "NOT_STARTED" }] }),
    });
    expect(f?.classification).toBe("duplicate");
    expect(f?.proposedAction).toBeUndefined();
  });

  it("CONTRADICTORY: conversation claims subscription but commercial is inactive", () => {
    const s = state({
      commercialSignals: [{ kind: "claims_subscribed", text: "we signed and paid", evidence: [], resolution: "resolved" }],
    });
    const [f] = reconcile({
      state: s,
      context: ctx({ commercialState: inactiveSub, openDeal: { id: "d1", name: "x", stage: "Negotiation" } }),
    });
    expect(f?.classification).toBe("contradictory");
    expect(f?.authoritativeSource?.source).toBe("commercial");
  });

  it("STALE: commercial active but HubSpot still Trial", () => {
    const s = state({
      commercialSignals: [{ kind: "claims_subscribed", text: "we have subscribed", evidence: [], resolution: "resolved" }],
    });
    const [f] = reconcile({
      state: s,
      context: ctx({ commercialState: activeSub, openDeal: { id: "d1", name: "x", stage: "Trial" } }),
    });
    expect(f?.classification).toBe("stale");
    expect(f?.proposedAction?.type).toBe("update_stage");
    expect(f?.proposedAction?.requiresApproval).toBe(true);
  });

  it("AMBIGUOUS: owner unresolved", () => {
    const s = state({
      confirmedCommitments: [{ action: "send docs", owner: null, evidence: [], resolution: "ambiguous" }],
    });
    const [f] = reconcile({ state: s, context: ctx() });
    expect(f?.classification).toBe("ambiguous");
    expect(f?.rationaleCode).toBe("unresolvable_identity");
  });

  it("UNSAFE: consequential action must not auto-execute", () => {
    const s = state({
      confirmedCommitments: [{ action: "cancel the subscription", owner: "Sarah", evidence: [], resolution: "resolved" }],
    });
    const [f] = reconcile({ state: s, context: ctx() });
    expect(f?.classification).toBe("unsafe");
    expect(f?.risk).toBe("high");
  });

  it("ALIGNED: intent-only signal does not claim Closed Won", () => {
    const s = state({
      commercialSignals: [{ kind: "intent_to_subscribe", text: "we want to subscribe", evidence: [], resolution: "resolved" }],
    });
    const [f] = reconcile({ state: s, context: ctx({ commercialState: inactiveSub, openDeal: { id: "d1", name: "x", stage: "Trial" } }) });
    expect(f?.classification).toBe("aligned");
    expect(f?.proposedAction).toBeUndefined();
    expect(f?.rationaleCode).toBe("intent_not_subscription_state");
  });
});

describe("source-authority examples", () => {
  it("'we want to subscribe' + inactive + Trial -> do NOT claim Closed Won", () => {
    const [f] = reconcile({
      state: state({ commercialSignals: [{ kind: "intent_to_subscribe", text: "we want to subscribe", evidence: [], resolution: "resolved" }] }),
      context: ctx({ commercialState: inactiveSub, openDeal: { id: "d1", name: "x", stage: "Trial" } }),
    });
    expect(f?.classification).toBe("aligned");
    expect(f?.proposedAction).toBeUndefined();
  });

  it("'we have subscribed' + active + Trial -> HubSpot stale, recommend Closed Won evaluation", () => {
    const [f] = reconcile({
      state: state({ commercialSignals: [{ kind: "claims_subscribed", text: "we have subscribed", evidence: [], resolution: "resolved" }] }),
      context: ctx({ commercialState: activeSub, openDeal: { id: "d1", name: "x", stage: "Trial" } }),
    });
    expect(f?.classification).toBe("stale");
    expect((f?.proposedAction?.payload as { stage: string })?.stage).toBe("closedwon");
  });

  it("'I'll send proposal Friday' + existing task -> duplicate, do not create another", () => {
    const [f] = reconcile({
      state: state({ confirmedCommitments: [{ action: "send proposal", owner: "Sarah", evidence: [], resolution: "resolved" }] }),
      context: ctx({ openTasks: [{ id: "t1", title: "Send proposal", type: "EMAIL", status: "NOT_STARTED" }] }),
    });
    expect(f?.classification).toBe("duplicate");
    expect(f?.proposedAction).toBeUndefined();
  });

  it("uses fact-specific authority (commercial authoritative for subscription state)", () => {
    expect(FACT_AUTHORITY.subscription_state.source).toBe("commercial");
    expect(FACT_AUTHORITY.subscription_state.authority).toBe("authoritative");
    expect(FACT_AUTHORITY.task_state.source).toBe("tasks");
  });
});

describe("execution gap detection", () => {
  it("emits gaps for missing/stale but not aligned/duplicate", () => {
    const missing = reconcile({
      state: state({ confirmedCommitments: [{ action: "send proposal", owner: "Sarah", evidence: [], resolution: "resolved" }] }),
      context: ctx(),
    });
    const gaps = detectExecutionGaps(missing);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.what).toBe("missing");

    const aligned = reconcile({
      state: state({ commercialSignals: [{ kind: "intent_to_subscribe", text: "we want to subscribe", evidence: [], resolution: "resolved" }] }),
      context: ctx({ commercialState: inactiveSub }),
    });
    expect(detectExecutionGaps(aligned)).toHaveLength(0);
  });
});
