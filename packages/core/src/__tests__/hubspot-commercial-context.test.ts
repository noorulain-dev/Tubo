import { describe, expect, it } from "vitest";
import {
  HubSpotCommercialContext,
  buildStateFromProperty,
  buildStateFromSubscription,
  mapCommercialStatus,
  type CommercialPropertyMapping,
} from "../index.js";

describe("mapCommercialStatus", () => {
  it("maps canonical statuses", () => {
    expect(mapCommercialStatus("active")).toBe("active");
    expect(mapCommercialStatus("trialing")).toBe("trial");
    expect(mapCommercialStatus("past_due")).toBe("past_due");
    expect(mapCommercialStatus("cancelled")).toBe("canceled");
    expect(mapCommercialStatus("")).toBe("none");
    expect(mapCommercialStatus(null)).toBe("none");
    expect(mapCommercialStatus("bogus")).toBe("none");
  });

  it("honors a custom status mapping", () => {
    expect(mapCommercialStatus("paying", { paying: "active" })).toBe("active");
  });
});

describe("buildStateFromSubscription", () => {
  it("builds an active native subscription with provenance", () => {
    const s = buildStateFromSubscription("acct", { id: "sub_1", status: "active", plan: "Pro", startAt: "2026-01-01T00:00:00Z" });
    expect(s.subscription?.status).toBe("active");
    expect(s.subscription?.plan).toBe("Pro");
    expect(s.provenance).toBe("hubspot_native_subscription");
  });

  it("treats cancelled as no subscription", () => {
    const s = buildStateFromSubscription("acct", { id: "sub_1", status: "canceled" });
    expect(s.subscription).toBeNull();
  });
});

describe("buildStateFromProperty", () => {
  it("builds active state from a mapped deal property", () => {
    const mapping: CommercialPropertyMapping = { objectType: "deal", statusProperty: "revexec_billing_status" };
    const s = buildStateFromProperty("deal_1", { revexec_billing_status: "active" }, mapping);
    expect(s.subscription?.status).toBe("active");
    expect(s.provenance).toContain("hubspot_property_mapping");
  });
});

describe("HubSpotCommercialContext", () => {
  it("uses native subscriptions first (active)", async () => {
    const ctx = new HubSpotCommercialContext({
      fetchSubscriptions: async () => [{ id: "s1", status: "active", plan: "Pro" }],
    });
    const state = await ctx.getCommercialState("acct");
    expect(state.subscription?.status).toBe("active");
    expect(state.provenance).toBe("hubspot_native_subscription");
  });

  it("falls back to property mapping when native returns empty", async () => {
    const ctx = new HubSpotCommercialContext({
      fetchSubscriptions: async () => [],
      readProperties: async (_t, _id) => ({ revexec_billing_status: "active" }),
      mapping: { objectType: "deal", statusProperty: "revexec_billing_status" },
    });
    const state = await ctx.getCommercialState("deal_1");
    expect(state.subscription?.status).toBe("active");
    expect(state.provenance).toContain("hubspot_property_mapping");
  });

  it("is unavailable with no source configured", async () => {
    const ctx = new HubSpotCommercialContext({});
    const { resolution, state } = await ctx.resolve("acct");
    expect(state.provenance).toBe("hubspot_commercial_unavailable");
    expect(resolution).toBe("unavailable");
  });

  it("never treats a native endpoint failure as 'not subscribed'", async () => {
    const ctx = new HubSpotCommercialContext({
      fetchSubscriptions: async () => {
        throw new Error("timeout");
      },
    });
    const state = await ctx.getCommercialState("acct");
    expect(state.subscription).toBeNull();
    expect(state.provenance).toBe("hubspot_commercial_unavailable");
  });

  it("resolves when a mapping yields an active subscription", async () => {
    const ctx = new HubSpotCommercialContext({
      readProperties: async () => ({ revexec_billing_status: "active" }),
      mapping: { objectType: "company", statusProperty: "revexec_billing_status" },
    });
    const { resolution } = await ctx.resolve("co_1");
    expect(resolution).toBe("resolved");
  });
});
