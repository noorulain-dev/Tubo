import { describe, expect, it } from "vitest";
import { ProviderError, StripeCommercialStateProvider } from "../index.js";

function makeFetch(routes: (url: string) => unknown) {
  return (async (input: unknown, _init: unknown) => {
    const url = String(input);
    return {
      ok: true,
      status: 200,
      json: async () => routes(url),
    };
  }) as unknown as typeof fetch;
}

describe("StripeCommercialStateProvider", () => {
  it("maps an active Stripe subscription to commercial state", async () => {
    const provider = new StripeCommercialStateProvider({
      secretKey: "sk_test",
      fetchImpl: makeFetch((url) => {
        if (url.includes("customers/search")) return { data: [{ id: "cus_123" }] };
        if (url.includes("subscriptions")) {
          return {
            data: [
              {
                id: "sub_1",
                status: "active",
                current_period_start: 1690000000,
                trial_start: 1680000000,
                trial_end: 1686000000,
                items: { data: [{ price: { nickname: "Pro" } }] },
              },
            ],
          };
        }
        return { data: [] };
      }),
    });

    const state = await provider.getCommercialState("acct-1");
    expect(state.subscription?.status).toBe("active");
    expect(state.subscription?.plan).toBe("Pro");
    expect(state.trial?.status).toBe("ended");
    expect(state.provenance).toBe("stripe");
  });

  it("returns null commercial exception (internal store, not Stripe)", async () => {
    const provider = new StripeCommercialStateProvider({
      secretKey: "sk_test",
      fetchImpl: makeFetch(() => ({ data: [] })),
    });
    expect(await provider.getCommercialException("acct-1")).toBeNull();
  });

  it("throws when no Stripe customer is found", async () => {
    const provider = new StripeCommercialStateProvider({
      secretKey: "sk_test",
      fetchImpl: makeFetch(() => ({ data: [] })),
    });
    await expect(provider.getCommercialState("missing")).rejects.toBeInstanceOf(ProviderError);
  });
});