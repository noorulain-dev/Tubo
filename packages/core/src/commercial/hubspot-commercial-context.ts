import type {
  CommercialException,
  CommercialState,
  CommercialStateReadProvider,
  CustomerActivity,
  SubscriptionState,
  SubscriptionStatus,
  TrialState,
} from "../commercial.js";

/** A native HubSpot Commerce subscription record (read-only). */
export interface HubSpotSubscriptionRecord {
  id: string;
  status: string;
  startAt?: string | null;
  endAt?: string | null;
  plan?: string | null;
}

/** Explicit per-user mapping of commercial state into a HubSpot CRM property. */
export interface CommercialPropertyMapping {
  objectType: "deal" | "company";
  statusProperty: string;
  startProperty?: string;
  endProperty?: string;
  statusValues?: Record<string, SubscriptionStatus>;
}

export type CommercialResolution = "resolved" | "unavailable" | "conflicting" | "missing_context";

const DEFAULT_STATUS_VALUES: Record<string, SubscriptionStatus> = {
  active: "active",
  trialing: "trial",
  trial: "trial",
  past_due: "past_due",
  pastdue: "past_due",
  canceled: "canceled",
  cancelled: "canceled",
  none: "none",
  inactive: "none",
  unknown: "none",
};

/** Map a raw HubSpot commercial property value to a canonical SubscriptionStatus. */
export function mapCommercialStatus(
  raw: string | null | undefined,
  statusValues?: Record<string, SubscriptionStatus>,
): SubscriptionStatus {
  if (raw == null || raw.trim() === "") return "none";
  const key = raw.trim().toLowerCase();
  const map = statusValues ?? DEFAULT_STATUS_VALUES;
  return map[key] ?? "none";
}

const INACTIVE_STATUSES: SubscriptionStatus[] = ["none", "canceled", "expired"];

export function buildStateFromSubscription(accountId: string, rec: HubSpotSubscriptionRecord): CommercialState {
  const status: SubscriptionStatus = mapCommercialStatus(rec.status);
  const subscription: SubscriptionState | null =
    INACTIVE_STATUSES.includes(status) ? null : { status, plan: rec.plan ?? null, startedAt: rec.startAt ?? null, endedAt: rec.endAt ?? null };
  return {
    accountId,
    trial: subTrial(status),
    subscription,
    lastActivityAt: null,
    commercialException: null,
    provenance: "hubspot_native_subscription",
  };
}

export function buildStateFromProperty(
  accountId: string,
  props: Record<string, string | null | undefined>,
  mapping: CommercialPropertyMapping,
): CommercialState {
  const status: SubscriptionStatus = mapCommercialStatus(props[mapping.statusProperty], mapping.statusValues);
  const subscription: SubscriptionState | null =
    INACTIVE_STATUSES.includes(status)
      ? null
      : {
          status,
          plan: null,
          startedAt: mapping.startProperty ? (props[mapping.startProperty] ?? null) : null,
          endedAt: mapping.endProperty ? (props[mapping.endProperty] ?? null) : null,
        };
  return {
    accountId,
    trial: subTrial(status),
    subscription,
    lastActivityAt: null,
    commercialException: null,
    provenance: `hubspot_property_mapping:${mapping.objectType}:${mapping.statusProperty}`,
  };
}

function subTrial(status: SubscriptionStatus): TrialState {
  return status === "trial" ? { status: "active" } : { status: "not_started" };
}

function unavailableState(accountId: string): CommercialState {
  return {
    accountId,
    trial: { status: "not_started" },
    subscription: null,
    lastActivityAt: null,
    commercialException: null,
    provenance: "hubspot_commercial_unavailable",
  };
}

export interface HubSpotCommercialContextOptions {
  /** Fetch native subscription records for an account (nil when unsupported). */
  fetchSubscriptions?: (accountId: string) => Promise<HubSpotSubscriptionRecord[] | null>;
  /** Read raw HubSpot properties for an object (used for the property mapping). */
  readProperties?: (objectType: "deal" | "company", objectId: string, properties: string[]) => Promise<Record<string, string | null | undefined>>;
  mapping?: CommercialPropertyMapping;
  nativeSupported?: boolean;
}

/**
 * HubSpot-backed authoritative commercial context. Strategy priority:
 *   1. native HubSpot Commerce subscription objects (when available),
 *   2. explicitly configured CRM property mapping,
 *   3. unavailable / missing_context (never guessed).
 * Deal stage is never treated as commercial truth.
 */
export class HubSpotCommercialContext implements CommercialStateReadProvider {
  constructor(private readonly opts: HubSpotCommercialContextOptions) {}

  async getCommercialState(accountId: string): Promise<CommercialState> {
    // 1. Native subscriptions (if supported + fetched successfully).
    if (this.opts.fetchSubscriptions) {
      try {
        const subs = await this.opts.fetchSubscriptions(accountId);
        if (subs && subs.length > 0) {
          const active = subs.find((s) => !["canceled", "cancelled", "inactive", "expired"].includes(s.status.toLowerCase())) ?? subs[0];
          return buildStateFromSubscription(accountId, active);
        }
      } catch {
        // fall through to mapping / unavailable
      }
    }

    // 2. Explicit property mapping.
    if (this.opts.mapping && this.opts.readProperties) {
      const m = this.opts.mapping;
      const props = await this.opts.readProperties(m.objectType, accountId, [m.statusProperty, m.startProperty, m.endProperty].filter(Boolean) as string[]);
      return buildStateFromProperty(accountId, props, m);
    }

    // 3. Unavailable.
    return unavailableState(accountId);
  }

  async getTrialState(accountId: string): Promise<TrialState | null> {
    return (await this.getCommercialState(accountId)).trial;
  }

  async getSubscriptionState(accountId: string): Promise<SubscriptionState | null> {
    return (await this.getCommercialState(accountId)).subscription;
  }

  async getCustomerActivity(_accountId: string): Promise<CustomerActivity | null> {
    return null;
  }

  async getCommercialException(_accountId: string): Promise<CommercialException | null> {
    return null;
  }

  /** The resolution state for this commercial source (separate from the state payload). */
  async resolve(accountId: string): Promise<{ resolution: CommercialResolution; state: CommercialState }> {
    const state = await this.getCommercialState(accountId);
    const resolution: CommercialResolution =
      state.provenance === "hubspot_commercial_unavailable" ? "unavailable" : state.subscription ? "resolved" : "missing_context";
    return { resolution, state };
  }
}