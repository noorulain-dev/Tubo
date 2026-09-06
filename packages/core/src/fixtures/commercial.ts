import type { CommercialState } from "../commercial.js";

/**
 * Deterministic synthetic commercial fixtures. Each entry covers a required
 * scenario and carries `provenance: "assessment-fixture"` so the synthetic
 * source is always identifiable.
 *
 * Account ids prefixed with `acct_` are generic demo fixtures; ids prefixed
 * with `co-` are aligned to the evaluation corpus in evals/cases.json so the
 * provider works unchanged in the evaluation runner and Sample Mode.
 */
const P = "assessment-fixture";

export const COMMERCIAL_FIXTURES: CommercialState[] = [
  // 1. Active trial (in progress, not yet converted).
  {
    accountId: "acct_active_trial",
    trial: {
      status: "active",
      startedAt: "2026-08-15T00:00:00Z",
      endedAt: "2026-09-15T00:00:00Z",
    },
    subscription: null,
    lastActivityAt: "2026-09-05T12:00:00Z",
    activityEvents: [{ at: "2026-09-05T12:00:00Z", kind: "api_call" }],
    commercialException: null,
    provenance: P,
  },
  // 2. Active subscription (converted).
  {
    accountId: "acct_active_sub",
    trial: {
      status: "ended",
      startedAt: "2026-07-01T00:00:00Z",
      endedAt: "2026-08-01T00:00:00Z",
    },
    subscription: { status: "active", plan: "pro", startedAt: "2026-08-01T00:00:00Z" },
    lastActivityAt: "2026-09-06T09:00:00Z",
    activityEvents: [
      { at: "2026-09-05T09:00:00Z", kind: "login" },
      { at: "2026-09-06T09:00:00Z", kind: "api_call" },
    ],
    commercialException: null,
    provenance: P,
  },
  // 3. Expired trial, no conversion, no exception.
  {
    accountId: "acct_expired_trial",
    trial: {
      status: "ended",
      startedAt: "2026-06-01T00:00:00Z",
      endedAt: "2026-07-01T00:00:00Z",
    },
    subscription: null,
    lastActivityAt: "2026-07-02T08:00:00Z",
    commercialException: null,
    provenance: P,
  },
  // 4. Trial with approved extension/exception (grace period).
  {
    accountId: "acct_trial_exception",
    trial: {
      status: "grace",
      startedAt: "2026-06-01T00:00:00Z",
      endedAt: "2026-07-01T00:00:00Z",
      graceEndsAt: "2026-07-15T00:00:00Z",
    },
    subscription: null,
    lastActivityAt: "2026-07-10T10:00:00Z",
    commercialException: {
      kind: "trial_extension",
      approved: true,
      reason: "procurement cycle",
      expiresAt: "2026-07-15T00:00:00Z",
    },
    provenance: P,
  },
  // 5. Incomplete state — account exists but no commercial data populated.
  {
    accountId: "acct_incomplete",
    trial: null,
    subscription: null,
    lastActivityAt: null,
    commercialException: null,
    provenance: P,
  },
  // 6. Edge case — conflicting: trial still "active" while a subscription is
  //    already "active". Downstream reconciliation must trust the subscription
  //    (authoritative) over the stale trial.
  {
    accountId: "acct_conflict",
    trial: {
      status: "active",
      startedAt: "2026-08-01T00:00:00Z",
      endedAt: "2026-09-01T00:00:00Z",
    },
    subscription: { status: "active", plan: "enterprise", startedAt: "2026-08-15T00:00:00Z" },
    lastActivityAt: "2026-09-06T11:00:00Z",
    commercialException: null,
    provenance: P,
  },

  // --- Evaluation-corpus seed (company ids from evals/cases.json) ---
  // co-007 Meridian Bank — active starter subscription (case-07).
  {
    accountId: "co-007",
    trial: { status: "ended", startedAt: "2026-01-15T00:00:00Z", endedAt: "2026-02-01T00:00:00Z" },
    subscription: { status: "active", plan: "starter", startedAt: "2026-02-01T00:00:00Z" },
    lastActivityAt: "2026-09-06T00:00:00Z",
    commercialException: null,
    provenance: P,
  },
  // co-008 Atlas Energy — active trial (case-08).
  {
    accountId: "co-008",
    trial: {
      status: "active",
      startedAt: "2026-08-15T00:00:00Z",
      endedAt: "2026-09-15T00:00:00Z",
      graceEndsAt: "2026-09-22T00:00:00Z",
    },
    subscription: { status: "trial" },
    lastActivityAt: "2026-09-05T00:00:00Z",
    commercialException: null,
    provenance: P,
  },
  // co-009 Fjord Analytics — active pro subscription, trial ended (case-09).
  {
    accountId: "co-009",
    trial: {
      status: "ended",
      startedAt: "2026-07-01T00:00:00Z",
      endedAt: "2026-08-01T00:00:00Z",
      graceEndsAt: "2026-08-08T00:00:00Z",
    },
    subscription: { status: "active", plan: "pro", startedAt: "2026-08-01T00:00:00Z" },
    lastActivityAt: "2026-09-06T00:00:00Z",
    commercialException: null,
    provenance: P,
  },
  // co-010 Orchard Systems — expired trial, no conversion (case-10).
  {
    accountId: "co-010",
    trial: {
      status: "ended",
      startedAt: "2026-06-01T00:00:00Z",
      endedAt: "2026-07-01T00:00:00Z",
      graceEndsAt: "2026-07-15T00:00:00Z",
    },
    subscription: null,
    lastActivityAt: "2026-07-02T00:00:00Z",
    commercialException: null,
    provenance: P,
  },
];

/**
 * Accounts whose commercial state is unavailable (simulated provider outage /
 * API timeout). These produce a retryable ProviderError, mirroring case-12's
 * unavailable commercial source.
 */
export const COMMERCIAL_UNAVAILABLE: Record<string, string> = {
  acct_unavailable: "simulated commercial provider outage",
  "co-012": "subscription service API timeout",
};
