import { describe, expect, it } from "vitest";
import {
  FACT_AUTHORITY,
  OperationalFactSchema,
  SourceAuthoritySchema,
} from "../index.js";

describe("source authority", () => {
  it("accepts a valid authority binding", () => {
    const sa = SourceAuthoritySchema.parse({
      source: "commercial",
      authority: "authoritative",
    });
    expect(sa.authority).toBe("authoritative");
  });

  it("rejects an invalid authority level", () => {
    expect(() =>
      SourceAuthoritySchema.parse({ source: "commercial", authority: "truthy" }),
    ).toThrow();
  });

  it("declares commercial authoritative for subscription state", () => {
    expect(FACT_AUTHORITY.subscription_state).toEqual({
      source: "commercial",
      authority: "authoritative",
    });
  });

  it("declares conversation as evidence-only for stated intent", () => {
    expect(FACT_AUTHORITY.stated_intent).toEqual({
      source: "conversation",
      authority: "evidence",
    });
  });

  it("requires source and authority on operational facts", () => {
    expect(() =>
      OperationalFactSchema.parse({ factType: "x", value: 1, retrievedAt: "now" }),
    ).toThrow();
  });
});
