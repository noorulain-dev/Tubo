import { describe, expect, it } from "vitest";
import {
  scanAccount,
  reconcileFindings,
  findingKey,
  type Finding,
} from "../accounts/risk-scanner.js";
import {
  EMPTY_SNAPSHOT,
  type AccountIntelligenceSnapshot,
  type CommitmentState,
  type QuestionState,
} from "../accounts/state-builder.js";

const NOW = "2026-09-10T00:00:00Z";

function snap(over: Partial<AccountIntelligenceSnapshot> = {}): AccountIntelligenceSnapshot {
  return { ...EMPTY_SNAPSHOT, ...over };
}

function commitment(over: Partial<CommitmentState> = {}): CommitmentState {
  return {
    id: "c1",
    accountId: "acct",
    type: "internal",
    description: "Send quote",
    owner: "Alex",
    ownerResolution: "resolved",
    dueDate: null,
    dueDateText: null,
    dueDateResolution: null,
    condition: null,
    status: "open",
    sourceEvidence: [],
    relatedTaskIds: [],
    relatedEmailIds: [],
    fulfillment: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function question(over: Partial<QuestionState> = {}): QuestionState {
  return {
    id: "q1",
    question: "When is pricing available?",
    sourceEvidence: [],
    askedAt: "2026-09-01T00:00:00Z",
    answer: null,
    answeredAt: null,
    status: "open",
    ...over,
  };
}

function scan(snapshot: AccountIntelligenceSnapshot) {
  return scanAccount({ userId: "u1", accountId: "acct", snapshot, now: NOW });
}

function types(fs: Finding[]): string[] {
  return fs.map((f) => f.type);
}

describe("Risk Scanner", () => {
  it("detects an overdue internal commitment with a deterministic severity signal", () => {
    const s = snap({ commitments: [commitment({ status: "overdue", dueDate: "2026-08-20T00:00:00Z" })] });
    const fs = scan(s).filter((f) => f.type === "overdue_internal_commitment");
    expect(fs.length).toBe(1);
    expect(fs[0].signals).toContainEqual({ signal: "days_overdue", value: 21 });
    expect(fs[0].severity).toBe("critical");
  });

  it("does not flag an answered question (condition resolved)", () => {
    const s = snap({ questions: [question({ status: "answered", answeredAt: NOW })] });
    expect(types(scan(s))).not.toContain("unanswered_customer_question");
  });

  it("detects a missing operational task for an open commitment", () => {
    const s = snap({ commitments: [commitment({ status: "open", relatedTaskIds: [] })] });
    expect(types(scan(s))).toContain("missing_operational_task");
  });

  it("does not flag a missing task once the task exists", () => {
    const s = snap({ commitments: [commitment({ status: "open", relatedTaskIds: ["task_1"] })] });
    expect(types(scan(s))).not.toContain("missing_operational_task");
  });

  it("flags commercial active + CRM Trial as a mismatch", () => {
    const s = snap({ commercial: { status: "active" }, stage: "Trial" });
    const fs = scan(s).filter((f) => f.type === "commercial_crm_mismatch");
    expect(fs.length).toBe(1);
    expect(fs[0].severity).toBe("high");
  });

  it("flags an unavailable commercial provider as missing_required_context (not aligned)", () => {
    const s = snap({ unavailableSources: ["commercial"] });
    const fs = scan(s).filter((f) => f.type === "missing_required_context");
    expect(fs.length).toBe(1);
    expect(fs[0].needsInvestigation).toBe(true);
  });

  it("surfaces a duplicate reconciliation gap as duplicate_action", () => {
    const s = snap({ reconciliationGaps: [{ type: "duplicate", what: "duplicate", title: "Duplicate task: Send quote", description: "already exists" }] });
    expect(types(scan(s))).toContain("duplicate_action");
  });

  it("flags customer_waiting_on_us for an open internal commitment with an upcoming deadline", () => {
    const s = snap({ commitments: [commitment({ status: "open", dueDate: "2026-09-12T00:00:00Z", dueDateResolution: "resolved" })] });
    const fs = scan(s).filter((f) => f.type === "customer_waiting_on_us");
    expect(fs.length).toBe(1);
    expect(fs[0].signals).toContainEqual({ signal: "days_until_due", value: 2 });
  });

  it("flags missing_next_step when there is open work but no next step", () => {
    const s = snap({ commitments: [commitment({ status: "open" })], nextSteps: [] });
    expect(types(scan(s))).toContain("missing_next_step");
  });

  it("is idempotent across rescans (stable finding ids, no duplicates)", () => {
    const s = snap({ commitments: [commitment({ status: "overdue", dueDate: "2026-08-20T00:00:00Z" })], questions: [question()] });
    const a = scan(s);
    const b = scan(s);
    expect(a.map((f) => f.findingId)).toEqual(b.map((f) => f.findingId));
    expect(new Set(a.map((f) => f.findingId)).size).toBe(a.length);
  });

  it("resolves findings that no longer appear and keeps those that persist", () => {
    const overdue = {
      findingId: findingKey("acct", "overdue_internal_commitment", "Overdue commitment: Send quote"),
      userId: "u1",
      accountId: "acct",
      type: "overdue_internal_commitment" as const,
      severity: "high" as const,
      title: "Overdue commitment: Send quote",
      description: "",
      evidence: [],
      sourceReferences: [],
      signals: [],
      needsInvestigation: true,
      status: "open" as const,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
      resolvedAt: null,
    };
    // Question was answered, so its finding disappears from the scan.
    const snapshot = snap({ questions: [question({ status: "answered" })], commitments: [commitment({ status: "overdue", dueDate: "2026-08-20T00:00:00Z" })] });
    const scanned = scan(snapshot);

    const staleQuestionFinding: Finding = {
      ...overdue,
      findingId: findingKey("acct", "unanswered_customer_question", "Unanswered question: When is pricing available?"),
      type: "unanswered_customer_question",
      title: "Unanswered question: When is pricing available?",
      severity: "low",
    };

    const reconciled = reconcileFindings([overdue, staleQuestionFinding], scanned, NOW);
    const byId = new Map(reconciled.map((f) => [f.findingId, f]));

    expect(byId.get(overdue.findingId)?.status).toBe("open"); // persists
    expect(byId.get(staleQuestionFinding.findingId)?.status).toBe("resolved"); // resolved
    expect(byId.get(staleQuestionFinding.findingId)?.resolvedAt).toBe(NOW);
  });
});
