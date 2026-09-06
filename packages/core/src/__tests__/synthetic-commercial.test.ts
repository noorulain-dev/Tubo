import { describe, expect, it } from "vitest";
import {
  AuditService,
  MemoryAuditSink,
  MissingContextError,
  ProviderError,
  createSyntheticCommercialProvider,
} from "../index.js";

const provider = createSyntheticCommercialProvider();

describe("synthetic commercial state provider", () => {
  it("returns an active trial state with provenance", async () => {
    const s = await provider.getCommercialState("acct_active_trial");
    expect(s.trial?.status).toBe("active");
    expect(s.subscription).toBeNull();
    expect(s.provenance).toBe("assessment-fixture");
  });

  it("returns an active subscription state", async () => {
    const sub = await provider.getSubscriptionState("acct_active_sub");
    expect(sub?.status).toBe("active");
    expect(sub?.plan).toBe("pro");
  });

  it("returns null trial for an account with no trial data", async () => {
    const t = await provider.getTrialState("acct_incomplete");
    expect(t).toBeNull();
  });

  it("returns an approved extension exception", async () => {
    const e = await provider.getCommercialException("acct_trial_exception");
    expect(e?.kind).toBe("trial_extension");
    expect(e?.approved).toBe(true);
  });

  it("returns customer activity when present", async () => {
    const a = await provider.getCustomerActivity("acct_active_sub");
    expect(a?.lastActivityAt).toBeTruthy();
    expect(a?.events.length).toBeGreaterThan(0);
  });

  it("returns null activity when none present", async () => {
    const a = await provider.getCustomerActivity("acct_incomplete");
    expect(a).toBeNull();
  });

  it("throws MissingContextError for an unknown account", async () => {
    await expect(provider.getCommercialState("does-not-exist")).rejects.toBeInstanceOf(
      MissingContextError,
    );
  });

  it("throws ProviderError for an unavailable account", async () => {
    await expect(provider.getCommercialState("acct_unavailable")).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it("serves eval-corpus seed (co-010 expired trial, no subscription)", async () => {
    const s = await provider.getCommercialState("co-010");
    expect(s.trial?.status).toBe("ended");
    expect(s.subscription).toBeNull();
  });

  it("exposes no mutation methods", () => {
    const p = provider as unknown as Record<string, unknown>;
    expect("createTask" in p).toBe(false);
    expect("updateStage" in p).toBe(false);
    expect("send" in p).toBe(false);
  });

  it("emits audit events on read", async () => {
    const sink = new MemoryAuditSink();
    const svc = new AuditService(sink);
    const p = createSyntheticCommercialProvider({ audit: svc });
    await p.getCommercialState("acct_active_trial");
    expect(sink.events.length).toBeGreaterThan(0);
    expect(sink.events[0]?.eventType).toBe("provider.commercial.read");
  });
});
