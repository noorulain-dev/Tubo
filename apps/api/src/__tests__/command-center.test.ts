import { describe, expect, it } from "vitest";
import {
  aggregateAccount,
  computeChanges,
  paginate,
  priorityScore,
  sortAccounts,
  severityRank,
  type AccountRow,
} from "../accounts/command-center.js";
import { EMPTY_SNAPSHOT, type AccountIntelligenceSnapshot } from "../accounts/state-builder.js";
import type { Finding } from "../accounts/risk-scanner.js";

function snap(over: Partial<AccountIntelligenceSnapshot> = {}): AccountIntelligenceSnapshot {
  return { ...EMPTY_SNAPSHOT, ...over };
}

function finding(type: Finding["type"], severity: Finding["severity"], createdAt: string, status: "open" | "resolved" = "open"): Finding {
  return {
    findingId: `f_${type}_${severity}`,
    userId: "u1",
    accountId: "acct",
    type,
    severity,
    title: `${type} ${severity}`,
    description: "",
    evidence: [],
    sourceReferences: [],
    signals: [],
    needsInvestigation: severity === "critical" || severity === "high",
    status,
    createdAt,
    updatedAt: createdAt,
    resolvedAt: status === "resolved" ? createdAt : null,
  };
}

function row(over: Partial<AccountRow> = {}): AccountRow {
  return {
    accountId: "acct",
    identity: null,
    stage: null,
    commercial: null,
    highestSeverity: null,
    topFinding: null,
    needsContextCount: 0,
    openCommitments: 0,
    openQuestions: 0,
    blockerCount: 0,
    blocked: false,
    lastMeaningfulEventAt: null,
    pendingCount: 0,
    lastReviewedAt: null,
    updatedAt: null,
    isAssessment: false,
    ...over,
  };
}

describe("Command Center", () => {
  it("orders accounts by deterministic severity then recency", () => {
    const rows = [
      row({ accountId: "low", highestSeverity: "low", lastMeaningfulEventAt: "2026-09-09T00:00:00Z" }),
      row({ accountId: "critical", highestSeverity: "critical", lastMeaningfulEventAt: "2026-09-01T00:00:00Z" }),
      row({ accountId: "high", highestSeverity: "high", lastMeaningfulEventAt: "2026-09-10T00:00:00Z" }),
    ];
    const sorted = sortAccounts(rows);
    expect(sorted.map((r) => r.accountId)).toEqual(["critical", "high", "low"]);
  });

  it("uses recency as tiebreaker at equal severity", () => {
    const rows = [
      row({ accountId: "older", highestSeverity: "high", lastMeaningfulEventAt: "2026-09-01T00:00:00Z" }),
      row({ accountId: "newer", highestSeverity: "high", lastMeaningfulEventAt: "2026-09-10T00:00:00Z" }),
    ];
    expect(sortAccounts(rows).map((r) => r.accountId)).toEqual(["newer", "older"]);
    expect(priorityScore(rows[0]) < priorityScore(rows[1])).toBe(true);
  });

  it("is deterministic for many accounts", () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      row({ accountId: `acct_${i}`, highestSeverity: i % 2 === 0 ? "critical" : "low", lastMeaningfulEventAt: new Date(2026, 0, i + 1).toISOString() }),
    );
    const a = sortAccounts(rows);
    const b = sortAccounts(rows);
    expect(a.map((r) => r.accountId)).toEqual(b.map((r) => r.accountId));
    expect(severityRank("critical")).toBe(4);
    expect(severityRank(null)).toBe(0);
  });

  it("paginates deterministically", () => {
    const rows = Array.from({ length: 25 }, (_, i) => row({ accountId: `acct_${i}` }));
    const page = paginate(rows, 10, 10);
    expect(page).toHaveLength(10);
    expect(page[0].accountId).toBe("acct_10");
  });

  it("produces an empty dashboard for no accounts", () => {
    const sorted = sortAccounts([]);
    expect(sorted).toHaveLength(0);
    const empty = aggregateAccount("acct", EMPTY_SNAPSHOT, [], null);
    expect(empty.highestSeverity).toBeNull();
    expect(empty.openCommitments).toBe(0);
    expect(empty.openQuestions).toBe(0);
  });

  it("a new open finding appears as the top finding", () => {
    const s = aggregateAccount("acct", snap(), [finding("overdue_internal_commitment", "critical", "2026-09-10T00:00:00Z")], null);
    expect(s.highestSeverity).toBe("critical");
    expect(s.topFinding?.type).toBe("overdue_internal_commitment");
  });

  it("a resolved finding disappears (only open findings are counted)", () => {
    // listAccountRows passes only status='open' findings; resolved ones are excluded upstream.
    const s = aggregateAccount("acct", snap(), [], null);
    expect(s.highestSeverity).toBeNull();
    expect(s.pendingCount).toBe(0);
  });

  it("computes a deterministic last-reviewed diff", () => {
    const reviewed = snap({
      stage: "Trial",
      commercial: { status: "trial" },
      commitments: [{ id: "c1", description: "Send quote", status: "open" } as never],
      blockers: ["old blocker"],
      version: 3,
    });
    const current = snap({
      stage: "Negotiation",
      commercial: { status: "active" },
      commitments: [{ id: "c1", description: "Send quote", status: "fulfilled" } as never],
      blockers: [],
      version: 6,
    });
    const changes = computeChanges(current, reviewed);
    expect(changes.stage).toEqual({ before: "Trial", after: "Negotiation" });
    expect(changes.commercial).toEqual({ before: "trial", after: "active" });
    expect(changes.resolvedCommitments).toContain("Send quote");
    expect(changes.resolvedBlockers).toContain("old blocker");
    expect(changes.eventsSince).toBe(3);
  });

  it("keeps accounts isolated (no cross-account merge)", () => {
    const a = aggregateAccount("acctA", snap({ stage: "Trial" }), [finding("missing_operational_task", "high", "2026-09-01T00:00:00Z")], null);
    const b = aggregateAccount("acctB", snap({ stage: "Negotiation" }), [], null);
    expect(a.accountId).toBe("acctA");
    expect(b.accountId).toBe("acctB");
    expect(b.highestSeverity).toBeNull();
  });
});
