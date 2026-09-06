import { describe, expect, it } from "vitest";
import {
  CommitmentSchema,
  ConditionalCommitmentSchema,
  GapTypeSchema,
  ResolutionStateSchema,
  SemanticStateSchema,
} from "../index.js";

const evidenceSpan = {
  source: "conversation",
  start: 0,
  end: 10,
  text: "I'll send it",
} as const;

describe("schema validation", () => {
  it("accepts a minimal semantic state via defaults", () => {
    const s = SemanticStateSchema.parse({ interactionId: "i-1" });
    expect(s.interactionId).toBe("i-1");
    expect(s.confirmedCommitments).toEqual([]);
    expect(s.conditionalCommitments).toEqual([]);
  });

  it("accepts a confirmed commitment with evidence", () => {
    const c = CommitmentSchema.parse({
      action: "send proposal",
      owner: "Sarah Chen",
      evidence: [evidenceSpan],
      resolution: "resolved",
    });
    expect(c.action).toBe("send proposal");
    expect(c.owner).toBe("Sarah Chen");
  });

  it("preserves a conditional commitment condition", () => {
    const c = ConditionalCommitmentSchema.parse({
      action: "sign order form",
      condition: "if procurement approves",
      evidence: [evidenceSpan],
      resolution: "ambiguous",
    });
    expect(c.condition).toBe("if procurement approves");
  });

  it("rejects an invalid resolution state", () => {
    expect(() => ResolutionStateSchema.parse("bogus")).toThrow();
  });

  it("rejects an invalid gap type", () => {
    expect(() => GapTypeSchema.parse("not-a-gap")).toThrow();
  });

  it("rejects a commitment without evidence", () => {
    expect(() =>
      CommitmentSchema.parse({ action: "x", resolution: "resolved" }),
    ).toThrow();
  });

  it("rejects a non-integer evidence span offset", () => {
    expect(() =>
      CommitmentSchema.parse({
        action: "x",
        evidence: [{ source: "conversation", start: 1.5, end: 5, text: "x" }],
        resolution: "resolved",
      }),
    ).toThrow();
  });
});
