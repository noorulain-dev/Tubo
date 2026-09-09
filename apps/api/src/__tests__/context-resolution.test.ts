import { beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_CANDIDATES,
  assertNoAuthorityOverride,
  detectContextGaps,
  isValidationError,
  resolutionEventPayload,
  validateResolution,
  type ContextCandidates,
} from "../accounts/context-resolution.js";
import {
  __resetContextResolutionMemory,
  listContextResolutions,
  recordContextResolution,
} from "../accounts/context-resolution-repository.js";
import { EMPTY_SNAPSHOT, buildState, type AccountEvent, type AccountIntelligenceSnapshot, type CommitmentState } from "../accounts/state-builder.js";

function commitment(over: Partial<CommitmentState> = {}): CommitmentState {
  return {
    id: "cmt_1",
    accountId: "acct_1",
    type: "internal",
    description: "Send revised pricing by Friday",
    owner: null,
    ownerResolution: "ambiguous",
    dueDate: null,
    dueDateText: "Friday",
    dueDateResolution: "ambiguous",
    condition: null,
    status: "open",
    sourceEvidence: [{ source: "conversation", reference: "call_9" }],
    relatedTaskIds: [],
    relatedEmailIds: [],
    fulfillment: null,
    createdAt: "2024-05-01T00:00:00.000Z",
    updatedAt: "2024-05-01T00:00:00.000Z",
    ...over,
  };
}

function snapshot(over: Partial<AccountIntelligenceSnapshot> = {}): AccountIntelligenceSnapshot {
  return { ...EMPTY_SNAPSHOT, identity: { name: "Northwind" }, commitments: [commitment()], ...over };
}

function candidates(over: Partial<ContextCandidates> = {}): ContextCandidates {
  return { ...EMPTY_CANDIDATES, ...over };
}

const ACCOUNT = "acct_1";

describe("context gap detection", () => {
  it("asks who owns a commitment when no source names an owner", () => {
    const gaps = detectContextGaps({ accountId: ACCOUNT, snapshot: snapshot(), findings: [] });
    const owner = gaps.find((g) => g.type === "missing_owner");
    expect(owner).toBeDefined();
    expect(owner!.question).toBe("Who owns this follow-up?");
    expect(owner!.known.some((k) => k.includes("Send revised pricing"))).toBe(true);
    expect(owner!.unverified.length).toBeGreaterThan(0);
    expect(owner!.blocksExecution).toBe(true);
  });

  it("does not ask about a commitment whose owner is already resolved", () => {
    const s = snapshot({ commitments: [commitment({ owner: "Sarah Chen", ownerResolution: "resolved" })] });
    const gaps = detectContextGaps({ accountId: ACCOUNT, snapshot: s, findings: [] });
    expect(gaps.some((g) => g.type === "missing_owner")).toBe(false);
  });

  it("offers owner candidates only from real data", () => {
    const s = snapshot({
      commitments: [commitment(), commitment({ id: "cmt_2", description: "Share security doc", owner: "John Lee", ownerResolution: "resolved" })],
    });
    const c = candidates({ people: [{ id: "u1", name: "Sarah Chen", role: "Account Executive", origin: "workspace" }] });
    const gap = detectContextGaps({ accountId: ACCOUNT, snapshot: s, findings: [], candidates: c }).find((g) => g.type === "missing_owner")!;
    expect(gap.options.map((o) => o.label)).toEqual(["Sarah Chen", "John Lee"]);
  });

  it("asks for a deadline without ever proposing one", () => {
    const gap = detectContextGaps({ accountId: ACCOUNT, snapshot: snapshot(), findings: [] }).find((g) => g.type === "missing_deadline")!;
    expect(gap.allowDate).toBe(true);
    expect(gap.options).toHaveLength(0);
    expect(gap.unverified.join(" ")).toContain("fabricate");
  });

  it("offers account candidates when identity is unlinked and other accounts exist", () => {
    const c = candidates({ accounts: [{ accountId: "acct_2", name: "Northwind Traders" }] });
    const gap = detectContextGaps({ accountId: ACCOUNT, snapshot: snapshot(), findings: [], candidates: c }).find((g) => g.type === "ambiguous_account")!;
    expect(gap.options).toHaveLength(1);
    expect(gap.options[0]!.value).toEqual({ canonicalAccountId: "acct_2" });
  });

  it("never invents a contact when the CRM cannot be read", () => {
    const c = candidates({ unavailableSources: ["hubspot"] });
    const gap = detectContextGaps({ accountId: ACCOUNT, snapshot: snapshot(), findings: [], candidates: c }).find((g) => g.type === "ambiguous_contact")!;
    expect(gap.options).toHaveLength(0);
    expect(gap.resolvable).toBe(false);
    expect(gap.cta?.href).toContain("settings");
  });

  it("shows deal candidates with stage metadata", () => {
    const c = candidates({ deals: [{ id: "deal_1", name: "Renewal FY25", stage: "negotiation", amount: 50000 }] });
    const gap = detectContextGaps({ accountId: ACCOUNT, snapshot: snapshot(), findings: [], candidates: c }).find((g) => g.type === "missing_deal")!;
    expect(gap.options[0]!.detail).toContain("negotiation");
  });
});

describe("commercial authority is never human-assertable", () => {
  const c = candidates({ commercialChecked: true, commercialConfigured: false });

  it("reports unconfigured commercial authority as not resolvable, with a config CTA", () => {
    const gap = detectContextGaps({ accountId: ACCOUNT, snapshot: snapshot(), findings: [], candidates: c }).find(
      (g) => g.type === "missing_commercial_authority",
    )!;
    expect(gap.resolvable).toBe(false);
    expect(gap.options).toHaveLength(0);
    expect(gap.cta?.label).toBe("Configure commercial source");
  });

  it("refuses any attempt to answer it", () => {
    const gap = detectContextGaps({ accountId: ACCOUNT, snapshot: snapshot(), findings: [], candidates: c }).find(
      (g) => g.type === "missing_commercial_authority",
    )!;
    const result = validateResolution(gap, { kind: "option", optionId: "paid" });
    expect(isValidationError(result)).toBe(true);
    expect((result as { code: string }).code).toBe("GAP_NOT_RESOLVABLE");
  });

  it("rejects a payload that tries to set authoritative fields", () => {
    expect(() => assertNoAuthorityOverride({ status: "paid" })).toThrow();
    expect(() => assertNoAuthorityOverride({ stage: "closedwon" })).toThrow();
    expect(() => assertNoAuthorityOverride({ commitmentUpdates: [] })).not.toThrow();
  });
});

describe("resolution validation", () => {
  const ownerGap = () =>
    detectContextGaps({
      accountId: ACCOUNT,
      snapshot: snapshot(),
      findings: [],
      candidates: candidates({ people: [{ id: "u1", name: "Sarah Chen", role: "AE", origin: "workspace" }] }),
    }).find((g) => g.type === "missing_owner")!;

  it("accepts an option that exists in the candidate set", () => {
    const gap = ownerGap();
    const result = validateResolution(gap, { kind: "option", optionId: gap.options[0]!.optionId });
    expect(isValidationError(result)).toBe(false);
    expect((result as { selectedLabel: string }).selectedLabel).toBe("Sarah Chen");
  });

  it("rejects a value that is not one of the real candidates", () => {
    const result = validateResolution(ownerGap(), { kind: "option", optionId: "owner_madeup" });
    expect(isValidationError(result)).toBe(true);
  });

  it("rejects a date on a gap that is not about dates", () => {
    expect(isValidationError(validateResolution(ownerGap(), { kind: "date", date: "2024-06-01" }))).toBe(true);
  });

  it("rejects a malformed date", () => {
    const gap = detectContextGaps({ accountId: ACCOUNT, snapshot: snapshot(), findings: [] }).find((g) => g.type === "missing_deadline")!;
    expect(isValidationError(validateResolution(gap, { kind: "date", date: "next friday" }))).toBe(true);
    expect(isValidationError(validateResolution(gap, { kind: "date", date: "2024-06-01" }))).toBe(false);
  });

  it("leaving unresolved is always allowed and changes no state", () => {
    const result = validateResolution(ownerGap(), { kind: "unresolved" });
    expect(isValidationError(result)).toBe(false);
    const payload = resolutionEventPayload(result as never);
    expect(payload.commitmentUpdates).toBeUndefined();
    expect(payload.identityUpdates).toBeUndefined();
  });
});

describe("reconciliation through the existing pipeline", () => {
  function event(payload: Record<string, unknown>): AccountEvent {
    return {
      eventId: "evt_res",
      userId: "u1",
      accountId: ACCOUNT,
      eventType: "manual_correction",
      occurredAt: "2024-05-02T00:00:00.000Z",
      source: "system",
      sourceReference: null,
      payload,
      provenance: "human_supplied",
    };
  }

  it("owner resolution updates state and is marked human-supplied without rewriting evidence", () => {
    const gap = detectContextGaps({
      accountId: ACCOUNT,
      snapshot: snapshot(),
      findings: [],
      candidates: candidates({ people: [{ id: "u1", name: "Sarah Chen", role: "AE", origin: "workspace" }] }),
    }).find((g) => g.type === "missing_owner")!;
    const validated = validateResolution(gap, { kind: "option", optionId: gap.options[0]!.optionId });
    const payload = { ...resolutionEventPayload(validated as never), resolvedBy: "Noor" };

    const state = buildState([event(payload)], { prior: snapshot(), now: "2024-05-02T00:00:00.000Z" });
    const c = state.commitments[0]!;
    expect(c.owner).toBe("Sarah Chen");
    expect(c.ownerResolution).toBe("resolved");
    expect(c.ownerProvenance).toBe("human_supplied");
    expect(c.ownerResolvedBy).toBe("Noor");
    // Source history is untouched: the transcript never said "Sarah Chen".
    expect(c.sourceEvidence).toEqual([{ source: "conversation", reference: "call_9" }]);
  });

  it("account resolution links identity and re-derives state", () => {
    const gap = detectContextGaps({
      accountId: ACCOUNT,
      snapshot: snapshot(),
      findings: [],
      candidates: candidates({ accounts: [{ accountId: "acct_2", name: "Northwind Traders" }] }),
    }).find((g) => g.type === "ambiguous_account")!;
    const validated = validateResolution(gap, { kind: "option", optionId: gap.options[0]!.optionId });
    const state = buildState([event(resolutionEventPayload(validated as never))], { prior: snapshot(), now: "2024-05-02T00:00:00.000Z" });
    expect(state.identity?.companyId).toBe("acct_2");
    expect(detectContextGaps({ accountId: ACCOUNT, snapshot: state, findings: [] }).some((g) => g.type === "ambiguous_account")).toBe(false);
  });

  it("resolving a deadline as unspecified records no fabricated date and stops asking", () => {
    const payload = { provenanceTag: "human_supplied", commitmentUpdates: [{ commitmentId: "cmt_1", dueDateWaived: true }] };
    const state = buildState([event(payload)], { prior: snapshot(), now: "2024-05-02T00:00:00.000Z" });
    expect(state.commitments[0]!.dueDate).toBeNull();
    expect(state.commitments[0]!.dueDateWaived).toBe(true);
    expect(detectContextGaps({ accountId: ACCOUNT, snapshot: state, findings: [] }).some((g) => g.type === "missing_deadline")).toBe(false);
  });

  it("resolving context never approves or executes anything", () => {
    const gap = detectContextGaps({
      accountId: ACCOUNT,
      snapshot: snapshot(),
      findings: [],
      candidates: candidates({ people: [{ id: "u1", name: "Sarah Chen", role: "AE", origin: "workspace" }] }),
    }).find((g) => g.type === "missing_owner")!;
    const validated = validateResolution(gap, { kind: "option", optionId: gap.options[0]!.optionId });
    const payload = resolutionEventPayload(validated as never);
    expect(Object.keys(payload)).not.toContain("approval");
    expect(Object.keys(payload)).not.toContain("execute");
    const state = buildState([event(payload)], { prior: snapshot(), now: "2024-05-02T00:00:00.000Z" });
    // Commercial truth and stage are untouched by a human identity resolution.
    expect(state.commercial).toBeNull();
    expect(state.stage).toBeNull();
  });
});

describe("audit trail", () => {
  beforeEach(() => __resetContextResolutionMemory());

  const base = {
    accountId: ACCOUNT,
    gapId: "gap_1",
    gapType: "missing_owner" as const,
    subjectKind: "commitment",
    subjectId: "cmt_1",
    subjectLabel: "Send revised pricing by Friday",
    question: "Who owns this follow-up?",
    originalAmbiguity: ["No source names a specific owner."],
    choiceKind: "option" as const,
    selectedLabel: "Sarah Chen",
    selectedValue: { owner: "Sarah Chen" },
    provenance: "human_supplied" as const,
    accountEventId: "evt_1",
    runId: null,
    findingId: null,
  };

  it("records who resolved it, when, the original ambiguity and the selection", async () => {
    await recordContextResolution({ ...base, userId: "u1", resolvedBy: "u1", resolvedByName: "Noor" });
    const [record] = await listContextResolutions("u1", ACCOUNT);
    expect(record!.resolvedByName).toBe("Noor");
    expect(record!.provenance).toBe("human_supplied");
    expect(record!.originalAmbiguity).toEqual(base.originalAmbiguity);
    expect(record!.selectedLabel).toBe("Sarah Chen");
    expect(Date.parse(record!.resolvedAt)).not.toBeNaN();
  });

  it("persists across reads (survives a page refresh)", async () => {
    await recordContextResolution({ ...base, userId: "u1", resolvedBy: "u1", resolvedByName: "Noor" });
    expect(await listContextResolutions("u1", ACCOUNT)).toHaveLength(1);
    expect(await listContextResolutions("u1", ACCOUNT)).toHaveLength(1);
  });

  it("is scoped to the resolving user", async () => {
    await recordContextResolution({ ...base, userId: "u1", resolvedBy: "u1", resolvedByName: "Noor" });
    expect(await listContextResolutions("u2", ACCOUNT)).toHaveLength(0);
  });
});
