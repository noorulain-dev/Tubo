import type {
  CommercialException,
  CommercialState,
  CommercialStateReadProvider,
  CustomerActivity,
  SubscriptionState,
  TrialState,
} from "./commercial.js";
import { AuditService, NoopAuditSink } from "./audit-service.js";
import { MissingContextError, ProviderError } from "./errors.js";
import { COMMERCIAL_FIXTURES, COMMERCIAL_UNAVAILABLE } from "./fixtures/commercial.js";

export interface SyntheticCommercialStateProviderOptions {
  fixtures?: CommercialState[];
  unavailable?: Record<string, string>;
  audit?: AuditService;
  provenance?: string;
}

/**
 * Deterministic, read-only synthetic implementation of
 * CommercialStateReadProvider. It behaves behind the same contract a real
 * Stripe/product-data integration would implement, but resolves against static
 * assessment fixtures so it runs with no network access (evaluation runner +
 * Sample Mode).
 *
 * Read-only guarantees:
 *  - implements only the read interface (no mutation methods)
 *  - fixtures are frozen on construction
 */
export class SyntheticCommercialStateProvider implements CommercialStateReadProvider {
  readonly provenance: string;
  private readonly fixtures: Map<string, CommercialState>;
  private readonly unavailable: Map<string, string>;
  private readonly audit: AuditService;

  constructor(opts: SyntheticCommercialStateProviderOptions = {}) {
    this.provenance = opts.provenance ?? "assessment-fixture";
    this.fixtures = new Map();
    for (const f of opts.fixtures ?? COMMERCIAL_FIXTURES) {
      this.fixtures.set(f.accountId, Object.freeze({ ...f, provenance: this.provenance }));
    }
    this.unavailable = new Map(Object.entries(opts.unavailable ?? COMMERCIAL_UNAVAILABLE));
    this.audit = opts.audit ?? new AuditService(new NoopAuditSink());
  }

  private resolve(accountId: string): CommercialState {
    const reason = this.unavailable.get(accountId);
    if (reason) {
      throw new ProviderError(
        `Commercial state unavailable for account "${accountId}": ${reason}`,
        { retryable: true },
      );
    }
    const state = this.fixtures.get(accountId);
    if (!state) {
      throw new MissingContextError(
        `No commercial state available for account "${accountId}"; account is not present in assessment fixtures`,
      );
    }
    return state;
  }

  private log(method: string, accountId: string): void {
    this.audit.emit({
      eventType: "provider.commercial.read",
      payload: { provider: "commercial", method, accountId, provenance: this.provenance },
    });
  }

  async getCommercialState(accountId: string): Promise<CommercialState> {
    this.log("getCommercialState", accountId);
    return this.resolve(accountId);
  }

  async getTrialState(accountId: string): Promise<TrialState | null> {
    this.log("getTrialState", accountId);
    return this.resolve(accountId).trial;
  }

  async getSubscriptionState(accountId: string): Promise<SubscriptionState | null> {
    this.log("getSubscriptionState", accountId);
    return this.resolve(accountId).subscription;
  }

  async getCustomerActivity(accountId: string): Promise<CustomerActivity | null> {
    this.log("getCustomerActivity", accountId);
    const state = this.resolve(accountId);
    const events = state.activityEvents ?? [];
    if (!state.lastActivityAt && events.length === 0) {
      return null;
    }
    return {
      accountId: state.accountId,
      lastActivityAt: state.lastActivityAt ?? null,
      events,
    };
  }

  async getCommercialException(accountId: string): Promise<CommercialException | null> {
    this.log("getCommercialException", accountId);
    return this.resolve(accountId).commercialException;
  }
}

/**
 * Convenience factory wired to the default deterministic fixtures.
 */
export function createSyntheticCommercialProvider(
  opts: Omit<SyntheticCommercialStateProviderOptions, "fixtures" | "unavailable"> = {},
): SyntheticCommercialStateProvider {
  return new SyntheticCommercialStateProvider(opts);
}
