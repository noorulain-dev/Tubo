import { describe, expect, it } from "vitest";
import {
  applyDecision,
  approveAllEligible,
  buildExecutionPlan,
  executeApproved,
  planKey,
  type ExecutionPlan,
} from "../proposals/execution-plans.js";
import type { PolicyContext, ProposedAction } from "../shared/core.js";

function action(type: ProposedAction["type"], target: string, payload: Record<string, unknown> = {}, id?: string): ProposedAction {
  return { id, type, target, payload, requiresApproval: true, blocked: false };
}

const ctx: PolicyContext = { commercialState: null, openDeal: null };

function build(actions: ProposedAction[], deps: Record<string, string[]> = {}) {
  return buildExecutionPlan({
    accountId: "acct",
    findingIds: ["f1"],
    objective: "Recover ACME security-blocker follow-up",
    actions: actions.map((a) => ({ action: a, dependsOn: deps[a.id ?? ""] })),
    policyContext: ctx,
    now: "2026-09-10T00:00:00Z",
  });
}

describe("Execution Plans", () => {
  it("builds a three-action plan with independent policy statuses", () => {
    const plan = build([
      action("create_task", "acct", { owner: "Alex", title: "Follow up" }, "a1"),
      action("create_note", "acct", { body: "Logged blocker" }, "a2"),
      action("create_draft", "acct", { to: "buyer@acme.com", subject: "Follow up" }, "a3"),
    ]);
    expect(plan.actions).toHaveLength(3);
    expect(plan.actions.map((a) => a.status)).toEqual(["pending_approval", "ready", "pending_approval"]);
  });

  it("blocks one action without blocking unrelated safe actions", () => {
    const plan = build([
      action("create_note", "acct", { body: "safe" }, "a1"),
      // "send" is outside the allowlist → blocked by policy.
      action("send" as never, "acct", {}, "a2"),
      action("create_note", "acct", { body: "also safe" }, "a3"),
    ]);
    expect(plan.actions.find((a) => a.actionId === "a2")?.status).toBe("blocked");
    expect(plan.actions.find((a) => a.actionId === "a1")?.status).toBe("ready");
    expect(plan.actions.find((a) => a.actionId === "a3")?.status).toBe("ready");
  });

  it("rejects a single action", () => {
    const plan = build([action("create_task", "acct", { owner: "Alex" }, "a1"), action("create_note", "acct", {}, "a2")]);
    const next = applyDecision(plan, "a1", "reject");
    expect(next.actions.find((a) => a.actionId === "a1")?.status).toBe("rejected");
    expect(next.actions.find((a) => a.actionId === "a2")?.status).toBe("ready");
  });

  it("revalidates an edited action (editing a draft to send=true re-blocks it)", () => {
    const plan = build([action("create_draft", "acct", { to: "buyer@acme.com" }, "a1")]);
    expect(plan.actions[0].status).toBe("pending_approval");
    const next = applyDecision(plan, "a1", "edit", { payload: { to: "buyer@acme.com", send: true } });
    expect(next.actions[0].status).toBe("blocked");
    expect(next.actions[0].policy.reasonCode).toBe("external_send_requested");
  });

  it("ambiguous owner blocks a task but not a note", () => {
    const plan = build([
      action("create_task", "acct", {}, "a1"), // no owner → ambiguous
      action("create_note", "acct", { body: "note" }, "a2"),
    ]);
    expect(plan.actions.find((a) => a.actionId === "a1")?.status).toBe("blocked");
    expect(plan.actions.find((a) => a.actionId === "a1")?.policy.reasonCode).toBe("ambiguous_owner");
    expect(plan.actions.find((a) => a.actionId === "a2")?.status).toBe("ready");
  });

  it("treats a Gmail draft as approval-required, and sending as blocked", () => {
    const plan = build([action("create_draft", "acct", { to: "buyer@acme.com", subject: "x" }, "a1")]);
    expect(plan.actions[0].status).toBe("pending_approval");

    const sendPlan = build([action("create_draft", "acct", { to: "buyer@acme.com", send: true }, "a2")]);
    expect(sendPlan.actions[0].status).toBe("blocked");
  });

  it("flags a deal-stage change to Closed Won without an active subscription as high risk (blocked)", () => {
    const plan = buildExecutionPlan({
      accountId: "acct",
      objective: "close won",
      actions: [{ action: action("update_stage", "acct", { stage: "closedwon" }, "a1") }],
      policyContext: { commercialState: null, openDeal: { stage: "Trial" } } as PolicyContext,
    });
    expect(plan.actions[0].status).toBe("blocked");
    expect(plan.actions[0].policy.risk).toBe("high");
  });

  it("supports partial execution (only approved actions execute)", async () => {
    const plan = build([
      action("create_task", "acct", { owner: "Alex" }, "a1"),
      action("create_note", "acct", {}, "a2"),
      action("create_draft", "acct", { to: "b@acme.com" }, "a3"),
    ]);
    // approve only a1 and a2
    let p = applyDecision(plan, "a1", "approve");
    p = applyDecision(p, "a2", "approve");

    const executed = await executeApproved(p, async (a) => ({ status: "success", idempotencyKey: `k:${a.type}`, externalRef: "ref" }));

    expect(executed.actions.find((a) => a.actionId === "a1")?.status).toBe("executed");
    expect(executed.actions.find((a) => a.actionId === "a2")?.status).toBe("executed");
    expect(executed.actions.find((a) => a.actionId === "a3")?.status).toBe("pending_approval"); // untouched
  });

  it("does not duplicate plans (stable plan id for identical objective+findings)", () => {
    const a = build([action("create_task", "acct", { owner: "Alex" }, "a1")]);
    const b = build([action("create_task", "acct", { owner: "Alex" }, "a1")]);
    expect(a.planId).toBe(b.planId);
    expect(planKey("acct", "Recover ACME security-blocker follow-up", ["f1"])).toBe(a.planId);
  });

  it("marks a downstream action dependency-blocked when its upstream is unresolved", () => {
    const plan = build(
      [action("create_task", "acct", { owner: "Alex" }, "a1"), action("create_draft", "acct", { to: "b@acme.com" }, "a2")],
      { a2: ["a1"] },
    );
    const a2 = plan.actions.find((x) => x.actionId === "a2")!;
    expect(a2.dependencyBlocked).toBe(true);
    expect(a2.status).toBe("blocked");
  });
});
