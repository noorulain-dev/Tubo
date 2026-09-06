import { z } from "zod";

export const TRIAL_STATUSES = ["not_started", "active", "grace", "ended"] as const;
export const TrialStatusSchema = z.enum(TRIAL_STATUSES);
export type TrialStatus = z.infer<typeof TrialStatusSchema>;

export const TrialStateSchema = z.object({
  status: TrialStatusSchema,
  startedAt: z.string().nullable().optional(),
  endedAt: z.string().nullable().optional(),
  graceEndsAt: z.string().nullable().optional(),
});
export type TrialState = z.infer<typeof TrialStateSchema>;

export const SUBSCRIPTION_STATUSES = [
  "none",
  "trial",
  "active",
  "past_due",
  "canceled",
  "expired",
] as const;
export const SubscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const SubscriptionStateSchema = z.object({
  status: SubscriptionStatusSchema,
  plan: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  endedAt: z.string().nullable().optional(),
});
export type SubscriptionState = z.infer<typeof SubscriptionStateSchema>;

export const CommercialExceptionSchema = z.object({
  kind: z.string(),
  approved: z.boolean(),
  reason: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
});
export type CommercialException = z.infer<typeof CommercialExceptionSchema>;

export const ActivityEventSchema = z.object({
  at: z.string(),
  kind: z.string(),
});
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export const CustomerActivitySchema = z.object({
  accountId: z.string(),
  lastActivityAt: z.string().nullable().optional(),
  events: z.array(ActivityEventSchema).default([]),
});
export type CustomerActivity = z.infer<typeof CustomerActivitySchema>;

/**
 * Aggregated, authoritative commercial state for an account. This is the
 * canonical shape returned by the commercial provider, matching the assessment
 * fixture contract. `provenance` records the fixture source so synthetic data
 * is always distinguishable from real integration data.
 */
export const CommercialStateSchema = z.object({
  accountId: z.string(),
  trial: TrialStateSchema.nullable(),
  subscription: SubscriptionStateSchema.nullable(),
  lastActivityAt: z.string().nullable().optional(),
  activityEvents: z.array(ActivityEventSchema).optional(),
  commercialException: CommercialExceptionSchema.nullable(),
  provenance: z.string(),
});
export type CommercialState = z.infer<typeof CommercialStateSchema>;

/**
 * Read-only commercial state contract. A real Stripe / product-data integration
 * implements this same interface; the synthetic provider is a drop-in.
 * There are deliberately no write/mutation methods.
 */
export interface CommercialStateReadProvider {
  getCommercialState(accountId: string): Promise<CommercialState>;
  getTrialState(accountId: string): Promise<TrialState | null>;
  getSubscriptionState(accountId: string): Promise<SubscriptionState | null>;
  getCustomerActivity(accountId: string): Promise<CustomerActivity | null>;
  getCommercialException(accountId: string): Promise<CommercialException | null>;
}
