import type {
  CommercialException,
  CommercialState,
  CommercialStateReadProvider,
  CustomerActivity,
  SubscriptionState,
  SubscriptionStatus,
  TrialState,
  TrialStatus,
} from "../commercial.js";
import { ProviderError } from "../errors.js";

export interface StripeCommercialOptions {
  secretKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface StripeList<T> {
  data?: T[];
}

interface StripeCustomer {
  id: string;
  email?: string | null;
  name?: string | null;
  metadata?: Record<string, string>;
}

interface StripeSubscription {
  id: string;
  status: string;
  current_period_start?: number;
  current_period_end?: number;
  trial_start?: number | null;
  trial_end?: number | null;
  items?: { data?: { price?: { nickname?: string | null; unit_amount?: number | null } }[] };
  plan?: { nickname?: string | null };
}

function epochToIso(seconds: number | null | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

function mapSubscriptionStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "trialing":
      return "trial";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "none";
  }
}

function planName(sub: StripeSubscription): string | null {
  return sub.items?.data?.[0]?.price?.nickname ?? sub.plan?.nickname ?? null;
}

/**
 * Stripe-backed authoritative commercial state. Maps an account (CRM company)
 * to a Stripe customer via customer metadata `account_id`, then reads the
 * customer's subscriptions to derive trial/subscription state.
 *
 * Stripe has no concept of an "approved exception" (trial extension) — that
 * lives in an internal store — so `commercialException` is always null here.
 */
export class StripeCommercialStateProvider implements CommercialStateReadProvider {
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: StripeCommercialOptions) {
    this.secretKey = opts.secretKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.stripe.com").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  async getCommercialState(accountId: string): Promise<CommercialState> {
    const customerId = await this.resolveCustomerId(accountId);
    if (!customerId) {
      throw new ProviderError(`No Stripe customer found for account "${accountId}"`, {
        status: 404,
        details: { notFound: true },
      });
    }
    const sub = await this.activeSubscription(customerId);
    return this.toState(accountId, sub);
  }

  async getTrialState(accountId: string): Promise<TrialState | null> {
    return (await this.getCommercialState(accountId)).trial;
  }

  async getSubscriptionState(accountId: string): Promise<SubscriptionState | null> {
    return (await this.getCommercialState(accountId)).subscription;
  }

  async getCustomerActivity(accountId: string): Promise<CustomerActivity | null> {
    try {
      const state = await this.getCommercialState(accountId);
      return state.lastActivityAt ? { accountId, lastActivityAt: state.lastActivityAt, events: [] } : null;
    } catch {
      return null;
    }
  }

  async getCommercialException(_accountId: string): Promise<CommercialException | null> {
    return null; // approved extensions live in an internal store, not Stripe
  }

  private async resolveCustomerId(accountId: string): Promise<string | null> {
    // 1. Search customers by the `account_id` metadata field.
    const query = `metadata["account_id"]:"${accountId.replace(/"/g, '\\"')}"`;
    try {
      const res = await this.get<StripeList<StripeCustomer>>(`/v1/customers/search?query=${encodeURIComponent(query)}`);
      const found = res.data?.[0];
      if (found) return found.id;
    } catch {
      // fall through to direct-id strategy
    }
    // No customer resolved by account_id metadata — do not assume accountId is
    // a Stripe customer id, since that would silently mask missing mappings.
    return null;
  }

  private async activeSubscription(customerId: string): Promise<StripeSubscription | null> {
    const res = await this.get<StripeList<StripeSubscription>>(`/v1/subscriptions?customer=${customerId}&status=all&limit=10`);
    const subs = res.data ?? [];
    return subs.find((s) => !["canceled", "incomplete_expired"].includes(s.status)) ?? subs[0] ?? null;
  }

  private toState(accountId: string, sub: StripeSubscription | null): CommercialState {
    const status: SubscriptionStatus = sub ? mapSubscriptionStatus(sub.status) : "none";
    const trialStatus: TrialStatus = sub?.status === "trialing" ? "active" : sub?.trial_end ? "ended" : "not_started";

    return {
      accountId,
      trial: sub
        ? {
            status: trialStatus,
            startedAt: epochToIso(sub.trial_start),
            endedAt: epochToIso(sub.trial_end),
            graceEndsAt: null,
          }
        : { status: "not_started" },
      subscription: status === "none" ? null : { status, plan: planName(sub!), startedAt: epochToIso(sub!.current_period_start) },
      lastActivityAt: null,
      commercialException: null,
      provenance: "stripe",
    };
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${this.secretKey}` },
    });
    if (!res.ok) {
      throw new ProviderError(`Stripe request failed (${res.status})`, {
        details: { httpStatus: res.status },
        retryable: res.status === 429 || res.status >= 500,
      });
    }
    return (await res.json()) as T;
  }
}