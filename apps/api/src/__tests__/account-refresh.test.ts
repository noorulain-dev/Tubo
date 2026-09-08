import { describe, expect, it } from "vitest";
import {
  detectChanges,
  fingerprintSource,
  refreshAccount,
  EMPTY_SOURCE_STATE,
  type DetectedChange,
  type SourceState,
} from "../accounts/account-refresh.js";

function state(over: Partial<SourceState> = {}): SourceState {
  return { ...EMPTY_SOURCE_STATE, ...over };
}

describe("account-refresh change detection", () => {
  it("no change → no new event", () => {
    const s = state({ stage: "Trial", commercialStatus: "active", openTaskIds: ["t1"], gmailThreadIds: ["m1"] });
    expect(detectChanges(s, s)).toEqual([]);
    expect(fingerprintSource(s)).toBe(fingerprintSource(s));
  });

  it("task completed → task_completed event", () => {
    const prev = state({ openTaskIds: ["t1", "t2"] });
    const curr = state({ openTaskIds: ["t2"] });
    const changes = detectChanges(prev, curr);
    expect(changes).toEqual([{ eventType: "task_completed", payload: { taskId: "t1" }, source: "hubspot", provenance: "account_refresh" }]);
  });

  it("commercial status change → commercial_state_observed event", () => {
    const changes = detectChanges(state({ commercialStatus: "trial" }), state({ commercialStatus: "active" }));
    expect(changes).toContainEqual({ eventType: "commercial_state_observed", payload: { status: "active" }, source: "commercial", provenance: "account_refresh" });
  });

  it("deal stage change → crm_state_observed event", () => {
    const changes = detectChanges(state({ stage: "Trial" }), state({ stage: "Negotiation" }));
    expect(changes).toContainEqual({ eventType: "crm_state_observed", payload: { stage: "Negotiation" }, source: "hubspot", provenance: "account_refresh" });
  });

  it("known Gmail reply → email_observed event", () => {
    const changes = detectChanges(state({ gmailThreadIds: [] }), state({ gmailThreadIds: ["msg_1"] }));
    expect(changes).toContainEqual({ eventType: "email_observed", payload: { reference: "msg_1" }, source: "gmail", provenance: "account_refresh" });
  });

  it("provider unavailable → unavailable marker (never a fabricated value)", () => {
    const prev = state({ commercialStatus: "active" });
    const curr = state({ commercialStatus: null, unavailableSources: ["commercial"] });
    const changes = detectChanges(prev, curr);
    expect(changes).toContainEqual({ eventType: "commercial_state_observed", payload: { unavailable: true }, source: "commercial", provenance: "account_refresh" });
    expect(changes.some((c) => c.payload.status === null)).toBe(false);
  });
});

describe("refreshAccount orchestration", () => {
  function deps(over: {
    read?: (accountId: string) => Promise<SourceState>;
    previous?: Record<string, SourceState>;
  } = {}) {
    const emitted: { userId: string; accountId: string; change: DetectedChange }[] = [];
    const saved: { userId: string; accountId: string; state: SourceState }[] = [];
    const prevMap = new Map<string, SourceState>();
    for (const [k, v] of Object.entries(over.previous ?? {})) prevMap.set(k, v);
    return {
      emitted,
      saved,
      deps: {
        readSource: over.read ?? (async () => state({ stage: "Trial" })),
        loadPrevious: async (userId: string, accountId: string) => prevMap.get(`${userId}:${accountId}`) ?? null,
        savePrevious: async (userId: string, accountId: string, s: SourceState) => {
          saved.push({ userId, accountId, state: s });
          prevMap.set(`${userId}:${accountId}`, s);
        },
        emit: async (userId: string, accountId: string, change: DetectedChange) => {
          emitted.push({ userId, accountId, change });
        },
      },
    };
  }

  it("duplicate refresh (no change) does not emit a new event", async () => {
    const d = deps({ read: async () => state({ stage: "Trial", commercialStatus: "active" }) });
    await refreshAccount("u1", "acct", d.deps);
    const firstCount = d.emitted.length; // stage + commercial both changed from empty
    expect(firstCount).toBeGreaterThan(0);

    const second = await refreshAccount("u1", "acct", d.deps);
    expect(second).toEqual([]);
    expect(d.emitted.length).toBe(firstCount); // unchanged
  });

  it("tenant isolation: persists and emits scoped to (userId, accountId)", async () => {
    const d = deps({ read: async () => state({ stage: "Trial" }) });
    await refreshAccount("u1", "acctA", d.deps);
    await refreshAccount("u2", "acctB", d.deps);
    expect(d.saved.map((s) => `${s.userId}:${s.accountId}`)).toEqual(["u1:acctA", "u2:acctB"]);
    expect(d.emitted.every((e) => e.userId === "u1" || e.userId === "u2")).toBe(true);
  });

  it("propagates rate-limit errors (transient, not swallowed/fabricated)", async () => {
    const d = deps({
      read: async () => {
        throw Object.assign(new Error("rate limited"), { status: 429 });
      },
    });
    await expect(refreshAccount("u1", "acct", d.deps)).rejects.toThrow("rate limited");
    expect(d.emitted.length).toBe(0); // nothing fabricated
  });
});
