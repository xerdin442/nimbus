/** How long a past-due subscription keeps working before suspension. */
export const BILLING_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export const BILLING_REFERENCE_PREFIX = 'nmb-sub-';

/** `usage_counters.key` for live tickets sold in the subscription-anchored month. */
export const USAGE_KEY = 'tickets';

/** The dashboard/email warning fires at this share of the monthly ticket limit. */
export const USAGE_WARNING_RATIO = 0.8;

export const BILLING_PLAN_KEYS = [
  'basic_monthly',
  'basic_annual',
  'pro_monthly',
  'pro_annual',
] as const;

export type BillingPlanKey = (typeof BILLING_PLAN_KEYS)[number];
